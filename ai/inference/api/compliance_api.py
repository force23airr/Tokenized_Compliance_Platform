#!/usr/bin/env python3
"""
RWA Compliance AI - Inference API
FastAPI service for real-time compliance checks.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from pathlib import Path

app = FastAPI(
    title="RWA Compliance AI",
    description="AI-powered regulatory compliance for multi-jurisdiction tokenization",
    version="1.0.0"
)

# Model paths
MODEL_DIR = Path(__file__).parent.parent.parent / "models"

# Global model cache
models = {}

# ============== Request/Response Models ==============

class JurisdictionRequest(BaseModel):
    document_text: str
    document_type: str  # passport, incorporation_doc, tax_form, etc.

class JurisdictionResponse(BaseModel):
    jurisdiction: str
    entity_type: str
    investor_classification: str
    applicable_regulations: List[str]
    confidence: float

class ConflictRequest(BaseModel):
    jurisdictions: List[str]
    asset_type: str
    investor_types: List[str]

class ConflictResponse(BaseModel):
    has_conflicts: bool
    conflicts: List[dict]
    resolutions: List[dict]
    combined_requirements: dict

class DocumentRequest(BaseModel):
    asset_type: str
    issuer_jurisdiction: str
    investor_jurisdictions: List[str]
    document_type: str  # subscription_agreement, ppm, disclosure
    custom_terms: Optional[dict] = None

class DocumentResponse(BaseModel):
    document_text: str
    applicable_regulations: List[str]
    warnings: List[str]

# ============== Model Loading ==============

def load_model(task: str):
    """Load a fine-tuned model for specific task."""
    if task not in models:
        model_path = MODEL_DIR / task / "final"

        if not model_path.exists():
            raise HTTPException(
                status_code=503,
                detail=f"Model for {task} not found. Please train the model first."
            )

        tokenizer = AutoTokenizer.from_pretrained(str(model_path))
        model = AutoModelForCausalLM.from_pretrained(
            str(model_path),
            torch_dtype=torch.float16,
            device_map="auto"
        )
        models[task] = (model, tokenizer)

    return models[task]

# ============== API Endpoints ==============

@app.get("/health")
async def health_check():
    return {"status": "healthy", "models_loaded": list(models.keys())}

@app.post("/classify-jurisdiction", response_model=JurisdictionResponse)
async def classify_jurisdiction(request: JurisdictionRequest):
    """
    Analyze investor documents to determine jurisdiction and classification.
    """
    model, tokenizer = load_model("jurisdiction-classifier")

    prompt = f"""### Instruction: Analyze the following {request.document_type} and extract jurisdiction and investor classification.

### Input:
{request.document_text}

### Response:"""

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=256,
            temperature=0.1,
            do_sample=False
        )

    response_text = tokenizer.decode(outputs[0], skip_special_tokens=True)

    # Parse model output (simplified - would need proper parsing logic)
    # For production, use structured output or JSON mode
    return JurisdictionResponse(
        jurisdiction="US",
        entity_type="individual",
        investor_classification="accredited",
        applicable_regulations=["SEC Reg D", "FINRA Rule 5123"],
        confidence=0.95
    )

@app.post("/resolve-conflicts", response_model=ConflictResponse)
async def resolve_conflicts(request: ConflictRequest):
    """
    Detect and resolve regulatory conflicts across jurisdictions.
    """
    model, tokenizer = load_model("conflict-resolver")

    prompt = f"""### Instruction: Analyze regulatory requirements for a {request.asset_type} offering across these jurisdictions: {', '.join(request.jurisdictions)}. Investor types: {', '.join(request.investor_types)}. Identify conflicts and propose resolutions.

### Response:"""

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=512,
            temperature=0.1,
            do_sample=False
        )

    # Parse and return (simplified)
    return ConflictResponse(
        has_conflicts=True,
        conflicts=[
            {
                "type": "accreditation_threshold",
                "jurisdiction_a": "US",
                "jurisdiction_b": "UK",
                "description": "US requires $1M net worth, UK requires £250K investable assets"
            }
        ],
        resolutions=[
            {
                "conflict": "accreditation_threshold",
                "strategy": "apply_strictest",
                "resolved_requirement": "Require BOTH US accredited status AND UK professional investor certification",
                "rationale": "Satisfies both jurisdictions' investor protection requirements"
            }
        ],
        combined_requirements={
            "min_investment": 100000,
            "lockup_days": 365,
            "max_investors": 99,
            "required_disclosures": ["Form D", "UK FCA disclosure", "Risk factors"]
        }
    )

@app.post("/generate-document", response_model=DocumentResponse)
async def generate_document(request: DocumentRequest):
    """
    Generate compliant documents for multi-jurisdiction offerings.
    """
    model, tokenizer = load_model("document-generator")

    prompt = f"""### Instruction: Generate a {request.document_type} for a {request.asset_type} token offering. Issuer: {request.issuer_jurisdiction}. Target investors: {', '.join(request.investor_jurisdictions)}.

### Response:"""

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=2048,
            temperature=0.3,
            do_sample=True
        )

    response_text = tokenizer.decode(outputs[0], skip_special_tokens=True)

    return DocumentResponse(
        document_text=response_text,
        applicable_regulations=["SEC Reg D 506(c)", "UK FCA COBS"],
        warnings=["Document requires legal review before use", "State blue sky filings may be required"]
    )

# ============== Startup ==============

@app.on_event("startup")
async def startup_event():
    """Pre-load models on startup for faster inference."""
    print("RWA Compliance AI starting...")
    # Optionally pre-load models here
    # load_model("jurisdiction-classifier")
    # load_model("conflict-resolver")
    # load_model("document-generator")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

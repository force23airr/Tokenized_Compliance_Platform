#!/usr/bin/env python3
"""
RWA Compliance AI - Training Script
Fine-tunes base models for jurisdiction classification, conflict resolution, and document generation.
"""

import os
import yaml
import torch
from pathlib import Path
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

# Load configuration
CONFIG_PATH = Path(__file__).parent.parent / "configs" / "training-config.yaml"

def load_config():
    with open(CONFIG_PATH, "r") as f:
        return yaml.safe_load(f)

def setup_model(config):
    """Load and prepare base model with LoRA."""
    model_name = config["base_model"]["name"]

    print(f"Loading base model: {model_name}")

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True
    )

    # Apply LoRA
    lora_config = LoraConfig(
        r=config["training"]["lora_config"]["r"],
        lora_alpha=config["training"]["lora_config"]["lora_alpha"],
        lora_dropout=config["training"]["lora_config"]["lora_dropout"],
        target_modules=config["training"]["lora_config"]["target_modules"],
        bias="none",
        task_type="CAUSAL_LM"
    )

    model = prepare_model_for_kbit_training(model)
    model = get_peft_model(model, lora_config)

    print(f"Trainable parameters: {model.print_trainable_parameters()}")

    return model, tokenizer

def prepare_dataset(config, tokenizer, task="jurisdiction_classifier"):
    """Load and tokenize dataset for specific task."""
    dataset_config = config["datasets"][task]
    dataset_path = dataset_config["path"]

    # Load dataset (adjust based on your data format)
    dataset = load_dataset("json", data_files={
        "train": f"{dataset_path}/train.jsonl",
        "validation": f"{dataset_path}/val.jsonl"
    })

    def tokenize_function(examples):
        # Format: instruction + input -> output
        texts = []
        for inp, out in zip(examples["input"], examples["output"]):
            text = f"### Instruction: Analyze the following document and extract compliance information.\n\n### Input:\n{inp}\n\n### Response:\n{out}"
            texts.append(text)

        return tokenizer(
            texts,
            truncation=True,
            max_length=config["training"]["hyperparameters"]["max_seq_length"],
            padding="max_length"
        )

    tokenized_dataset = dataset.map(tokenize_function, batched=True)
    return tokenized_dataset

def train(config, model, tokenizer, dataset, task_name):
    """Run training loop."""
    hp = config["training"]["hyperparameters"]
    output_dir = Path(config["output"]["model_dir"]) / task_name

    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=hp["num_epochs"],
        per_device_train_batch_size=hp["batch_size"],
        gradient_accumulation_steps=hp["gradient_accumulation_steps"],
        learning_rate=hp["learning_rate"],
        warmup_ratio=hp["warmup_ratio"],
        weight_decay=hp["weight_decay"],
        logging_dir=config["output"]["logs_dir"],
        logging_steps=10,
        save_strategy="epoch",
        evaluation_strategy="epoch",
        fp16=True,
        report_to="tensorboard"
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False)
    )

    print(f"Starting training for {task_name}...")
    trainer.train()

    # Save final model
    trainer.save_model(str(output_dir / "final"))
    tokenizer.save_pretrained(str(output_dir / "final"))

    print(f"Model saved to {output_dir / 'final'}")

def main():
    config = load_config()

    # Train each model
    tasks = ["jurisdiction_classifier", "conflict_resolver", "document_generator"]

    for task in tasks:
        print(f"\n{'='*50}")
        print(f"Training: {task}")
        print(f"{'='*50}\n")

        model, tokenizer = setup_model(config)
        dataset = prepare_dataset(config, tokenizer, task)
        train(config, model, tokenizer, dataset, task)

        # Clear memory between tasks
        del model
        torch.cuda.empty_cache()

if __name__ == "__main__":
    main()

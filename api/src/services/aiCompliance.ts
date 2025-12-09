import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

interface InvestorData {
  investorType: string;
  address: {
    street: string;
    city: string;
    state?: string;
    postal_code: string;
    country: string;
  };
  documents: string[];
}

interface JurisdictionClassification {
  jurisdiction: string;
  classification: string;
  confidence: number;
  applicable_regulations: string[];
}

/**
 * Call AI Compliance Engine to classify investor jurisdiction
 */
export async function classifyInvestorJurisdiction(
  data: InvestorData
): Promise<JurisdictionClassification> {
  try {
    logger.info('Calling AI compliance engine for jurisdiction classification');

    const response = await axios.post(
      `${config.externalServices.aiCompliance.apiUrl}/classify-jurisdiction`,
      {
        document_text: JSON.stringify(data.address),
        document_type: 'address',
      },
      {
        timeout: 10000,
      }
    );

    return {
      jurisdiction: response.data.jurisdiction,
      classification: response.data.investor_classification,
      confidence: response.data.confidence,
      applicable_regulations: response.data.applicable_regulations,
    };
  } catch (error) {
    logger.error('AI compliance call failed, using fallback', { error });

    // Fallback: Simple country-based classification
    return fallbackClassification(data);
  }
}

/**
 * Fallback classification when AI service is unavailable
 */
function fallbackClassification(data: InvestorData): JurisdictionClassification {
  const countryMapping: Record<string, { jurisdiction: string; defaultClass: string }> = {
    US: { jurisdiction: 'US', defaultClass: 'retail' },
    GB: { jurisdiction: 'UK', defaultClass: 'retail' },
    SG: { jurisdiction: 'SG', defaultClass: 'retail' },
    // Add more countries as needed
  };

  const mapping = countryMapping[data.address.country] || {
    jurisdiction: data.address.country,
    defaultClass: 'retail',
  };

  return {
    jurisdiction: mapping.jurisdiction,
    classification: mapping.defaultClass,
    confidence: 0.7,
    applicable_regulations: [],
  };
}

/**
 * Resolve regulatory conflicts across jurisdictions
 */
export async function resolveConflicts(
  jurisdictions: string[],
  assetType: string
): Promise<{
  has_conflicts: boolean;
  conflicts: any[];
  resolutions: any[];
  combined_requirements: any;
}> {
  try {
    const response = await axios.post(
      `${config.externalServices.aiCompliance.apiUrl}/resolve-conflicts`,
      {
        jurisdictions,
        asset_type: assetType,
        investor_types: ['accredited', 'professional'],
      },
      {
        timeout: 15000,
      }
    );

    return response.data;
  } catch (error) {
    logger.error('Conflict resolution failed', { error });

    // Fallback: Apply strictest rules
    return {
      has_conflicts: true,
      conflicts: [],
      resolutions: [
        {
          strategy: 'apply_strictest',
          resolved_requirement: 'Apply strictest rule from all jurisdictions',
        },
      ],
      combined_requirements: {},
    };
  }
}

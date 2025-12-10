/**
 * Compliance Hashing Utilities
 *
 * Generates cryptographic hashes for on-chain attestation of compliance data.
 * These hashes are stored on-chain while full data remains off-chain for privacy.
 */

import { ethers } from 'ethers';
import {
  InvestorComplianceHashInput,
  SanctionsCheckHashInput,
  AttestationHashInput,
  ComplianceTraceIdInput,
} from '../types/conflicts';

/**
 * Generate hash for investor compliance attestation
 * Used to prove KYC/accreditation status on-chain without exposing PII
 */
export function generateInvestorComplianceHash(
  input: InvestorComplianceHashInput
): string {
  const { investorId, kycDocHashes, accreditationType, accreditationExpiry } = input;

  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32[]', 'string', 'uint256'],
      [
        ethers.id(investorId),
        kycDocHashes.map((h) => ethers.id(h)),
        accreditationType || '',
        accreditationExpiry ? Math.floor(accreditationExpiry.getTime() / 1000) : 0,
      ]
    )
  );
}

/**
 * Generate hash for sanctions check audit trail
 * Proves a sanctions check was performed without exposing full response
 */
export function generateSanctionsCheckHash(
  input: SanctionsCheckHashInput
): string {
  const { address, provider, listVersion, timestamp } = input;

  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'string', 'bytes32', 'uint256'],
      [
        address,
        provider,
        ethers.id(listVersion),
        Math.floor(timestamp.getTime() / 1000),
      ]
    )
  );
}

/**
 * Generate hash for asset attestation
 * Proves custodian attestation of asset holdings/valuation
 */
export function generateAttestationHash(
  input: AttestationHashInput
): string {
  const { assetId, custodian, valuationAmount, timestamp, proofDocHashes } = input;

  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'address', 'uint256', 'uint256', 'bytes32[]'],
      [
        ethers.id(assetId),
        custodian,
        ethers.parseUnits(valuationAmount || '0', 18),
        Math.floor(timestamp.getTime() / 1000),
        proofDocHashes.map((h) => ethers.id(h)),
      ]
    )
  );
}

/**
 * Generate compliance trace ID for token-level tracking
 * Links token to specific ruleset version and jurisdictions
 */
export function generateComplianceTraceId(
  input: ComplianceTraceIdInput
): string {
  const { tokenId, rulesetVersion, jurisdictions, timestamp } = input;

  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'string[]', 'uint256'],
      [
        ethers.id(tokenId),
        rulesetVersion,
        jurisdictions,
        Math.floor(timestamp.getTime() / 1000),
      ]
    )
  );
}

/**
 * Generate hash for travel rule compliance
 * Proves travel rule data was collected without exposing originator/beneficiary details
 */
export function generateTravelRuleHash(
  transferId: string,
  originatorJurisdiction: string,
  beneficiaryJurisdiction: string,
  regime: string,
  status: string,
  timestamp: Date
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'string', 'string', 'string', 'string', 'uint256'],
      [
        ethers.id(transferId),
        originatorJurisdiction,
        beneficiaryJurisdiction,
        regime,
        status,
        Math.floor(timestamp.getTime() / 1000),
      ]
    )
  );
}

/**
 * Generate hash for lockup enforcement
 * Used to verify lockup parameters on-chain
 */
export function generateLockupHash(
  tokenId: string,
  investorAddress: string,
  unlockTimestamp: Date,
  lockupType: string
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'address', 'uint256', 'string'],
      [
        ethers.id(tokenId),
        investorAddress,
        Math.floor(unlockTimestamp.getTime() / 1000),
        lockupType,
      ]
    )
  );
}

/**
 * Generate hash for governance/audit compliance
 * Proves SOC2/ISO27001 certification without exposing full report
 */
export function generateGovernanceHash(
  entityId: string,
  soc2ReportHash: string | null,
  iso27001CertHash: string | null,
  dataResidency: string,
  timestamp: Date
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'bytes32', 'string', 'uint256'],
      [
        ethers.id(entityId),
        soc2ReportHash ? ethers.id(soc2ReportHash) : ethers.ZeroHash,
        iso27001CertHash ? ethers.id(iso27001CertHash) : ethers.ZeroHash,
        dataResidency,
        Math.floor(timestamp.getTime() / 1000),
      ]
    )
  );
}

/**
 * Verify a hash matches expected inputs (for off-chain verification)
 */
export function verifyHash(
  expectedHash: string,
  actualHash: string
): boolean {
  return expectedHash.toLowerCase() === actualHash.toLowerCase();
}

/**
 * Generate document hash from content
 * Used for hashing KYC documents, attestation docs, etc.
 */
export function hashDocument(content: string | Buffer): string {
  if (typeof content === 'string') {
    return ethers.id(content);
  }
  return ethers.keccak256(content);
}

/**
 * Generate a unique case ID for compliance cases
 */
export function generateCaseId(
  caseType: string,
  entityType: string,
  entityId: string,
  timestamp: Date
): string {
  const hash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'string', 'bytes32', 'uint256'],
      [
        caseType,
        entityType,
        ethers.id(entityId),
        Math.floor(timestamp.getTime() / 1000),
      ]
    )
  );
  // Return first 16 chars for readability
  return `CASE-${hash.slice(2, 10).toUpperCase()}`;
}

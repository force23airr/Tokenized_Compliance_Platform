// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICompliance
 * @notice Interface for compliance validation in RWA token transfers
 * @dev Implements "Smart Grandfathering" directional compliance system
 */
interface ICompliance {
    // ============= Directional Compliance Status =============

    /**
     * @notice Compliance status for investors
     * @dev Matches TypeScript enum in api/src/types/conflicts.ts
     *
     * UNAUTHORIZED (0): Default state - cannot interact (never onboarded)
     * APPROVED (1):     Full access - can buy and sell
     * GRANDFATHERED (2): Sell-only - can exit positions but cannot add new ones
     * FROZEN (3):       Blocked - cannot buy or sell (AML/Sanctions)
     */
    enum Status {
        UNAUTHORIZED,
        APPROVED,
        GRANDFATHERED,
        FROZEN
    }

    // ============= Events =============

    /**
     * @notice Emitted when an investor's compliance status is updated
     * @param investor The investor address
     * @param oldStatus Previous compliance status
     * @param newStatus New compliance status
     * @param updatedBy Address that triggered the update (oracle or compliance officer)
     */
    event StatusUpdated(
        address indexed investor,
        Status oldStatus,
        Status newStatus,
        address indexed updatedBy
    );

    /**
     * @notice Emitted when a transfer compliance check is performed
     * @param from Sender address
     * @param to Recipient address
     * @param allowed Whether transfer was allowed
     * @param reason Reason code for the decision
     */
    event ComplianceChecked(
        address indexed from,
        address indexed to,
        bool allowed,
        bytes32 reason
    );

    // ============= Core Compliance Functions =============

    /**
     * @notice Check if a transfer is allowed between two addresses
     * @param from Sender address
     * @param to Recipient address
     * @param amount Transfer amount (may affect compliance in future versions)
     * @return allowed Whether the transfer is compliant
     * @return reason Reason code (bytes32) for audit trail
     */
    function canTransfer(
        address from,
        address to,
        uint256 amount
    ) external view returns (bool allowed, bytes32 reason);

    /**
     * @notice Check if an address is on the whitelist
     * @param account Address to check
     * @return Whether the account is whitelisted
     */
    function isWhitelisted(address account) external view returns (bool);

    /**
     * @notice Check if an investor is accredited
     * @param account Address to check
     * @return Whether the account is accredited
     */
    function isAccredited(address account) external view returns (bool);

    // ============= Status Management =============

    /**
     * @notice Get an investor's current compliance status
     * @param investor Address to check
     * @return Current compliance status
     */
    function investorStatus(address investor) external view returns (Status);

    /**
     * @notice Get an investor's status with audit metadata
     * @param investor Address to check
     * @return status Current compliance status
     * @return updatedBlock Block number when status was last updated
     */
    function getStatus(address investor) external view returns (Status status, uint256 updatedBlock);

    /**
     * @notice Batch update investor statuses (gas optimized)
     * @dev Only callable by ORACLE_ROLE
     * @param investors Array of investor addresses
     * @param statuses Array of new statuses (must match investors length)
     */
    function batchUpdateStatus(
        address[] calldata investors,
        Status[] calldata statuses
    ) external;

    /**
     * @notice Update a single investor's status
     * @dev Only callable by COMPLIANCE_OFFICER_ROLE or ORACLE_ROLE
     * @param investor Investor address
     * @param newStatus New compliance status
     */
    function updateStatus(address investor, Status newStatus) external;
}

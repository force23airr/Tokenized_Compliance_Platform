// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/ICompliance.sol";

/**
 * @title ComplianceRegistry
 * @notice On-chain enforcement of "Smart Grandfathering" directional compliance
 * @dev Maps wallet addresses to Compliance Statuses and validates transfers
 *
 * Key Features:
 * - APPROVED investors can buy and sell freely
 * - GRANDFATHERED investors can SELL (exit) but cannot BUY (add to position)
 * - FROZEN investors are completely blocked (AML/Sanctions)
 * - UNAUTHORIZED investors cannot interact (never onboarded)
 *
 * This prevents the "Liquidity Trap" where regulatory changes freeze capital.
 * Instead, affected investors are grandfathered and can exit gracefully.
 */
contract ComplianceRegistry is ICompliance, AccessControl, Pausable {
    // ============= Constants =============

    /// @notice Role for compliance officers (manual status updates)
    bytes32 public constant COMPLIANCE_OFFICER_ROLE = keccak256("COMPLIANCE_OFFICER_ROLE");

    /// @notice Role for oracle (automated batch updates from off-chain)
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    /// @notice Ruleset version for regulatory traceability
    string public constant RULESET_VERSION = "1.0.0";

    // ============= Reason Codes =============

    bytes32 public constant REASON_SENDER_FROZEN = keccak256("SENDER_FROZEN");
    bytes32 public constant REASON_SENDER_UNAUTHORIZED = keccak256("SENDER_UNAUTHORIZED");
    bytes32 public constant REASON_RECIPIENT_FROZEN = keccak256("RECIPIENT_FROZEN");
    bytes32 public constant REASON_RECIPIENT_GRANDFATHERED = keccak256("RECIPIENT_GRANDFATHERED");
    bytes32 public constant REASON_RECIPIENT_UNAUTHORIZED = keccak256("RECIPIENT_UNAUTHORIZED");
    bytes32 public constant REASON_ALLOWED = keccak256("ALLOWED");

    // ============= State =============

    /// @notice Mapping: Investor wallet -> Compliance Status
    mapping(address => Status) private _investorStatus;

    /// @notice Mapping: Investor wallet -> Last updated block number (for audit)
    mapping(address => uint256) public lastUpdatedBlock;

    /// @notice Total number of status updates (for metrics)
    uint256 public totalStatusUpdates;

    // ============= Constructor =============

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(COMPLIANCE_OFFICER_ROLE, msg.sender);
    }

    // ============= External View Functions =============

    /**
     * @inheritdoc ICompliance
     */
    function investorStatus(address investor) external view override returns (Status) {
        return _investorStatus[investor];
    }

    /**
     * @inheritdoc ICompliance
     */
    function getStatus(address investor) external view override returns (Status status, uint256 updatedBlock) {
        return (_investorStatus[investor], lastUpdatedBlock[investor]);
    }

    /**
     * @inheritdoc ICompliance
     */
    function isWhitelisted(address account) external view override returns (bool) {
        Status status = _investorStatus[account];
        return status == Status.APPROVED || status == Status.GRANDFATHERED;
    }

    /**
     * @inheritdoc ICompliance
     */
    function isAccredited(address account) external view override returns (bool) {
        // For now, APPROVED status implies accredited
        // In future versions, this could check additional on-chain attestations
        return _investorStatus[account] == Status.APPROVED;
    }

    /**
     * @notice Check if an address can send tokens (is liquidity source)
     * @param account Address to check
     * @return Whether the account can send
     */
    function canSend(address account) external view returns (bool) {
        Status status = _investorStatus[account];
        return status == Status.APPROVED || status == Status.GRANDFATHERED;
    }

    /**
     * @notice Check if an address can receive tokens (is liquidity sink)
     * @param account Address to check
     * @return Whether the account can receive
     */
    function canReceive(address account) external view returns (bool) {
        return _investorStatus[account] == Status.APPROVED;
    }

    // ============= Transfer Validation =============

    /**
     * @inheritdoc ICompliance
     * @dev Implements directional compliance logic:
     *
     * SENDER (Liquidity Source):
     *   - FROZEN: Block (AML/Sanctions)
     *   - UNAUTHORIZED: Block (not onboarded)
     *   - APPROVED: Can send
     *   - GRANDFATHERED: Can send (exit position)
     *
     * RECIPIENT (Liquidity Sink):
     *   - FROZEN: Block
     *   - UNAUTHORIZED: Block
     *   - GRANDFATHERED: Block (cannot add to position)
     *   - APPROVED: Can receive
     */
    function canTransfer(
        address from,
        address to,
        uint256 /* amount */
    ) external view override returns (bool allowed, bytes32 reason) {
        Status fromStatus = _investorStatus[from];
        Status toStatus = _investorStatus[to];

        // 1. Check Sender (Liquidity Source)
        if (fromStatus == Status.FROZEN) {
            return (false, REASON_SENDER_FROZEN);
        }
        if (fromStatus == Status.UNAUTHORIZED) {
            return (false, REASON_SENDER_UNAUTHORIZED);
        }
        // APPROVED and GRANDFATHERED can send (exit position)

        // 2. Check Recipient (Liquidity Sink)
        if (toStatus == Status.FROZEN) {
            return (false, REASON_RECIPIENT_FROZEN);
        }
        if (toStatus == Status.GRANDFATHERED) {
            // CRITICAL: Grandfathered users cannot INCREASE position
            return (false, REASON_RECIPIENT_GRANDFATHERED);
        }
        if (toStatus == Status.UNAUTHORIZED) {
            return (false, REASON_RECIPIENT_UNAUTHORIZED);
        }

        // 3. Success - both parties compliant
        return (true, REASON_ALLOWED);
    }

    /**
     * @notice Check transfer and emit event (for token hooks that need logging)
     * @dev Non-view version that emits ComplianceChecked event
     */
    function checkTransfer(
        address from,
        address to,
        uint256 amount
    ) external whenNotPaused returns (bool allowed) {
        bytes32 reason;
        (allowed, reason) = this.canTransfer(from, to, amount);

        emit ComplianceChecked(from, to, allowed, reason);

        return allowed;
    }

    // ============= Status Management =============

    /**
     * @inheritdoc ICompliance
     */
    function updateStatus(
        address investor,
        Status newStatus
    ) external override onlyRole(COMPLIANCE_OFFICER_ROLE) whenNotPaused {
        _updateStatus(investor, newStatus);
    }

    /**
     * @inheritdoc ICompliance
     */
    function batchUpdateStatus(
        address[] calldata investors,
        Status[] calldata statuses
    ) external override onlyRole(ORACLE_ROLE) whenNotPaused {
        require(investors.length == statuses.length, "ComplianceRegistry: length mismatch");
        require(investors.length <= 100, "ComplianceRegistry: batch too large");

        for (uint256 i = 0; i < investors.length; i++) {
            _updateStatus(investors[i], statuses[i]);
        }
    }

    // ============= Admin Functions =============

    /**
     * @notice Pause all compliance checks (emergency)
     * @dev Only callable by admin
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause compliance checks
     * @dev Only callable by admin
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Grant oracle role to an address (for off-chain sync worker)
     * @param oracle Address to grant oracle role
     */
    function grantOracleRole(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(ORACLE_ROLE, oracle);
    }

    /**
     * @notice Revoke oracle role from an address
     * @param oracle Address to revoke oracle role from
     */
    function revokeOracleRole(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(ORACLE_ROLE, oracle);
    }

    // ============= Internal Functions =============

    /**
     * @notice Internal function to update investor status
     * @param investor Investor address
     * @param newStatus New compliance status
     */
    function _updateStatus(address investor, Status newStatus) internal {
        require(investor != address(0), "ComplianceRegistry: zero address");

        Status oldStatus = _investorStatus[investor];

        if (oldStatus != newStatus) {
            _investorStatus[investor] = newStatus;
            lastUpdatedBlock[investor] = block.number;
            totalStatusUpdates++;

            emit StatusUpdated(investor, oldStatus, newStatus, msg.sender);
        }
    }

    /**
     * @notice Helper to convert Status enum to uint8
     * @dev Useful for off-chain integrations
     */
    function _toUint(Status s) internal pure returns (uint8) {
        return uint8(s);
    }

    // ============= View Helpers =============

    /**
     * @notice Get status as uint8 for easier off-chain parsing
     * @param investor Address to check
     * @return Status as uint8 (0=UNAUTHORIZED, 1=APPROVED, 2=GRANDFATHERED, 3=FROZEN)
     */
    function getStatusAsUint(address investor) external view returns (uint8) {
        return _toUint(_investorStatus[investor]);
    }

    /**
     * @notice Batch get statuses for multiple investors
     * @param investors Array of investor addresses
     * @return statuses Array of statuses as uint8
     */
    function batchGetStatus(address[] calldata investors) external view returns (uint8[] memory statuses) {
        statuses = new uint8[](investors.length);
        for (uint256 i = 0; i < investors.length; i++) {
            statuses[i] = _toUint(_investorStatus[investors[i]]);
        }
    }
}

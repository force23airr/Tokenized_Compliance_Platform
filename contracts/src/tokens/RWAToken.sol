// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/ICompliance.sol";

/**
 * @title RWAToken
 * @notice ERC-20 token for Real World Assets with compliance hooks
 * @dev Enforces transfer restrictions via ComplianceRegistry
 *
 * Features:
 * - All transfers validated against ComplianceRegistry
 * - Minting/burning by authorized roles
 * - Pausable for emergency situations
 * - Reentrancy protection
 * - Compliance-first design (ERC-1404 compatible pattern)
 */
contract RWAToken is ERC20, ERC20Burnable, ERC20Pausable, AccessControl, ReentrancyGuard {
    // ============= Roles =============

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ============= State =============

    /// @notice Reference to the compliance registry
    ICompliance public immutable complianceRegistry;

    /// @notice Asset type (TREASURY, PRIVATE_CREDIT, REAL_ESTATE)
    string public assetType;

    /// @notice Decimals for the token
    uint8 private immutable _decimals;

    // ============= ERC-1404 Compatible Reason Codes =============

    uint8 public constant SUCCESS = 0;
    uint8 public constant SENDER_NOT_COMPLIANT = 1;
    uint8 public constant RECIPIENT_NOT_COMPLIANT = 2;
    uint8 public constant TRANSFER_PAUSED = 3;

    // ============= Events =============

    event ComplianceRegistrySet(address indexed registry);
    event TransferRestricted(address indexed from, address indexed to, uint256 amount, uint8 reasonCode);

    // ============= Errors =============

    error TransferNotCompliant(address from, address to, bytes32 reason);
    error InvalidComplianceRegistry();
    error ZeroAddress();

    // ============= Constructor =============

    /**
     * @notice Initialize the RWA Token
     * @param name_ Token name (e.g., "US Treasury 4.25% 2026")
     * @param symbol_ Token symbol (e.g., "UST-425-26")
     * @param decimals_ Token decimals (typically 18)
     * @param assetType_ Asset type identifier
     * @param totalSupply_ Initial total supply (minted to deployer)
     * @param complianceRegistry_ Address of the ComplianceRegistry contract
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        string memory assetType_,
        uint256 totalSupply_,
        address complianceRegistry_
    ) ERC20(name_, symbol_) {
        if (complianceRegistry_ == address(0)) revert InvalidComplianceRegistry();

        complianceRegistry = ICompliance(complianceRegistry_);
        assetType = assetType_;
        _decimals = decimals_;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);

        // Mint initial supply to deployer
        if (totalSupply_ > 0) {
            _mint(msg.sender, totalSupply_);
        }

        emit ComplianceRegistrySet(complianceRegistry_);
    }

    // ============= ERC-20 Overrides =============

    /**
     * @notice Returns the number of decimals
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Hook called before any token transfer
     * @dev Enforces compliance check via ComplianceRegistry
     *
     * Transfer validation logic:
     * - SKIP for minting (from = 0x0)
     * - SKIP for burning (to = 0x0)
     * - ENFORCE compliance check for all other transfers
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override(ERC20, ERC20Pausable) {
        // Skip compliance for minting and burning
        if (from != address(0) && to != address(0)) {
            // Regular transfer - enforce compliance
            (bool allowed, bytes32 reason) = complianceRegistry.canTransfer(from, to, value);

            if (!allowed) {
                emit TransferRestricted(from, to, value, _reasonToCode(reason));
                revert TransferNotCompliant(from, to, reason);
            }
        }

        super._update(from, to, value);
    }

    // ============= ERC-1404 Compatible Functions =============

    /**
     * @notice Detect transfer restriction (ERC-1404 pattern)
     * @param from Sender address
     * @param to Recipient address
     * @param value Transfer amount
     * @return restrictionCode 0 if allowed, non-zero for restriction reason
     */
    function detectTransferRestriction(
        address from,
        address to,
        uint256 value
    ) public view returns (uint8 restrictionCode) {
        if (paused()) {
            return TRANSFER_PAUSED;
        }

        // Skip check for mint/burn
        if (from == address(0) || to == address(0)) {
            return SUCCESS;
        }

        (bool allowed, bytes32 reason) = complianceRegistry.canTransfer(from, to, value);

        if (!allowed) {
            return _reasonToCode(reason);
        }

        return SUCCESS;
    }

    /**
     * @notice Get human-readable message for restriction code
     * @param restrictionCode The restriction code from detectTransferRestriction
     * @return message Human-readable restriction message
     */
    function messageForTransferRestriction(
        uint8 restrictionCode
    ) public pure returns (string memory message) {
        if (restrictionCode == SUCCESS) {
            return "Transfer allowed";
        } else if (restrictionCode == SENDER_NOT_COMPLIANT) {
            return "Sender not compliant (frozen, unauthorized, or blocked)";
        } else if (restrictionCode == RECIPIENT_NOT_COMPLIANT) {
            return "Recipient not compliant (frozen, grandfathered, or unauthorized)";
        } else if (restrictionCode == TRANSFER_PAUSED) {
            return "Transfers are paused";
        }
        return "Unknown restriction";
    }

    // ============= Minting =============

    /**
     * @notice Mint new tokens
     * @dev Only callable by MINTER_ROLE
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _mint(to, amount);
    }

    // ============= Pausable =============

    /**
     * @notice Pause all transfers
     * @dev Only callable by PAUSER_ROLE
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause transfers
     * @dev Only callable by PAUSER_ROLE
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ============= Internal Helpers =============

    /**
     * @notice Convert bytes32 reason to uint8 code for ERC-1404 compatibility
     */
    function _reasonToCode(bytes32 reason) internal pure returns (uint8) {
        // Sender-related reasons
        if (
            reason == keccak256("SENDER_FROZEN") ||
            reason == keccak256("SENDER_UNAUTHORIZED")
        ) {
            return SENDER_NOT_COMPLIANT;
        }

        // Recipient-related reasons
        if (
            reason == keccak256("RECIPIENT_FROZEN") ||
            reason == keccak256("RECIPIENT_GRANDFATHERED") ||
            reason == keccak256("RECIPIENT_UNAUTHORIZED")
        ) {
            return RECIPIENT_NOT_COMPLIANT;
        }

        return SUCCESS;
    }

    // ============= View Functions =============

    /**
     * @notice Check if a transfer would be allowed
     * @param from Sender
     * @param to Recipient
     * @param amount Amount
     * @return Whether transfer would succeed
     */
    function canTransfer(
        address from,
        address to,
        uint256 amount
    ) external view returns (bool) {
        return detectTransferRestriction(from, to, amount) == SUCCESS;
    }
}

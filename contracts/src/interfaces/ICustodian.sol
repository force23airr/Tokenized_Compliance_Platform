// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICustodian {
    function verifyAssetOwnership(bytes32 assetId) external view returns (bool);
    function getAssetBalance(bytes32 assetId) external view returns (uint256);
    function attestAssetHolding(bytes32 assetId) external returns (bytes memory);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICompliance {
    function canTransfer(
        address from,
        address to,
        uint256 amount
    ) external view returns (bool, bytes32);

    function isWhitelisted(address account) external view returns (bool);
    function isAccredited(address account) external view returns (bool);
}

import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { recordBlockchainMetrics } from '../middleware/metrics';

const prisma = new PrismaClient();

/**
 * Get blockchain provider for specified network
 */
function getProvider(blockchain: string): ethers.JsonRpcProvider {
  const networkConfig = {
    ethereum: config.blockchain.ethereum,
    polygon: config.blockchain.polygon,
    sepolia: config.blockchain.sepolia,
  }[blockchain];

  if (!networkConfig) {
    throw new Error(`Unsupported blockchain: ${blockchain}`);
  }

  return new ethers.JsonRpcProvider(networkConfig.rpcUrl);
}

/**
 * Get deployer wallet
 */
function getDeployerWallet(blockchain: string): ethers.Wallet {
  const provider = getProvider(blockchain);
  return new ethers.Wallet(config.blockchain.deployerPrivateKey, provider);
}

/**
 * Deploy token contract to blockchain
 */
export async function deployTokenContract(tokenId: string): Promise<void> {
  try {
    logger.info('Starting token deployment', { tokenId });

    const token = await prisma.token.findUnique({ where: { id: tokenId } });

    if (!token) {
      throw new Error('Token not found');
    }

    // Update status to deploying
    await prisma.token.update({
      where: { id: tokenId },
      data: { status: 'deploying' },
    });

    const wallet = getDeployerWallet(token.blockchain);

    // Get appropriate contract factory based on asset type
    const contractFactory = getContractFactory(token.assetType);

    // Deploy contract
    const contract = await contractFactory
      .connect(wallet)
      .deploy(
        token.name,
        token.symbol,
        token.totalSupply,
        token.decimals
      );

    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    const deploymentTx = contract.deploymentTransaction();

    // Record blockchain metrics
    recordBlockchainMetrics('token_deployment', undefined, deploymentTx?.hash);

    logger.info('Token deployed successfully', {
      tokenId,
      contractAddress,
      txHash: deploymentTx?.hash,
    });

    // Update token with deployment info
    await prisma.token.update({
      where: { id: tokenId },
      data: {
        status: 'deployed',
        contractAddress,
        deploymentTxHash: deploymentTx?.hash,
        deployedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error('Token deployment failed', { tokenId, error });

    await prisma.token.update({
      where: { id: tokenId },
      data: { status: 'failed' },
    });

    throw error;
  }
}

/**
 * Get contract factory based on asset type
 * NOTE: This is a placeholder - actual contracts need to be compiled and ABI loaded
 */
function getContractFactory(assetType: string): ethers.ContractFactory {
  // TODO: Load actual contract ABIs from artifacts
  // For now, returning a mock ERC20 factory

  const ERC20_ABI = [
    'constructor(string name, string symbol, uint256 totalSupply, uint8 decimals)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
  ];

  const ERC20_BYTECODE = '0x'; // Placeholder - would be actual compiled bytecode

  return new ethers.ContractFactory(ERC20_ABI, ERC20_BYTECODE);
}

/**
 * Execute on-chain transfer
 */
export async function executeTransfer(
  transferId: string
): Promise<{ txHash: string; blockNumber: number }> {
  const transfer = await prisma.transfer.findUnique({
    where: { id: transferId },
    include: { token: true },
  });

  if (!transfer || !transfer.token) {
    throw new Error('Transfer or token not found');
  }

  const wallet = getDeployerWallet(transfer.token.blockchain);
  const contract = new ethers.Contract(
    transfer.token.contractAddress!,
    ['function transfer(address to, uint256 amount) returns (bool)'],
    wallet
  );

  const tx = await contract.transfer(transfer.toAddress, transfer.amount);
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
  };
}

/**
 * Update investor whitelist on-chain
 */
export async function syncWhitelistToChain(
  tokenId: string,
  investorAddress: string,
  whitelisted: boolean
): Promise<string> {
  const token = await prisma.token.findUnique({ where: { id: tokenId } });

  if (!token || !token.contractAddress) {
    throw new Error('Token not deployed');
  }

  const wallet = getDeployerWallet(token.blockchain);
  const contract = new ethers.Contract(
    token.contractAddress,
    [
      'function addToWhitelist(address investor) returns (bool)',
      'function removeFromWhitelist(address investor) returns (bool)',
    ],
    wallet
  );

  const tx = whitelisted
    ? await contract.addToWhitelist(investorAddress)
    : await contract.removeFromWhitelist(investorAddress);

  const receipt = await tx.wait();
  return receipt.hash;
}

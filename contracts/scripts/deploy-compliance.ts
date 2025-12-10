import { ethers, run, network } from "hardhat";

async function main() {
  console.log("🚀 Deploying Compliance Registry to", network.name);
  console.log("━".repeat(50));

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("");

  // Deploy ComplianceRegistry
  console.log("📋 Deploying ComplianceRegistry...");
  const RegistryFactory = await ethers.getContractFactory("ComplianceRegistry");
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();

  const registryAddress = await registry.getAddress();
  console.log("✅ ComplianceRegistry deployed to:", registryAddress);

  // Log ruleset version
  const version = await registry.RULESET_VERSION();
  console.log("   Ruleset Version:", version);
  console.log("");

  // Deploy RWAToken (optional - for testing)
  if (process.env.DEPLOY_TEST_TOKEN === "true") {
    console.log("🪙 Deploying Test RWAToken...");
    const TokenFactory = await ethers.getContractFactory("RWAToken");
    const token = await TokenFactory.deploy(
      "Test Treasury Token",
      "TTT",
      18,
      "TREASURY",
      ethers.parseEther("1000000"),
      registryAddress
    );
    await token.waitForDeployment();

    const tokenAddress = await token.getAddress();
    console.log("✅ RWAToken deployed to:", tokenAddress);
    console.log("");
  }

  // Grant Oracle Role if specified
  if (process.env.ORACLE_ADDRESS) {
    console.log("🔑 Granting Oracle Role to:", process.env.ORACLE_ADDRESS);
    const tx = await registry.grantOracleRole(process.env.ORACLE_ADDRESS);
    await tx.wait();
    console.log("✅ Oracle role granted");
    console.log("");
  }

  // Verify on Etherscan (if not localhost)
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("⏳ Waiting for block confirmations before verification...");
    // Wait for 6 blocks to ensure indexing
    await new Promise((resolve) => setTimeout(resolve, 60000));

    console.log("🔍 Verifying contract on Etherscan...");
    try {
      await run("verify:verify", {
        address: registryAddress,
        constructorArguments: [],
      });
      console.log("✅ Contract verified on Etherscan");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Contract already verified");
      } else {
        console.log("⚠️ Verification failed:", error.message);
      }
    }
  }

  // Output deployment summary
  console.log("");
  console.log("━".repeat(50));
  console.log("📋 DEPLOYMENT SUMMARY");
  console.log("━".repeat(50));
  console.log(`Network:              ${network.name}`);
  console.log(`ComplianceRegistry:   ${registryAddress}`);
  console.log(`Deployer:             ${deployer.address}`);
  console.log(`Ruleset Version:      ${version}`);
  console.log("");
  console.log("📝 Add to your .env file:");
  console.log(`COMPLIANCE_REGISTRY_ADDRESS=${registryAddress}`);
  console.log("");

  return { registryAddress };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });

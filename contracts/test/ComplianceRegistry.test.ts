import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ComplianceRegistry, RWAToken } from "../typechain-types";

describe("ComplianceRegistry", function () {
  let registry: ComplianceRegistry;
  let token: RWAToken;
  let owner: SignerWithAddress;
  let oracle: SignerWithAddress;
  let complianceOfficer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  // Status enum values
  const Status = {
    UNAUTHORIZED: 0,
    APPROVED: 1,
    GRANDFATHERED: 2,
    FROZEN: 3,
  };

  beforeEach(async function () {
    [owner, oracle, complianceOfficer, alice, bob, charlie] = await ethers.getSigners();

    // Deploy ComplianceRegistry
    const RegistryFactory = await ethers.getContractFactory("ComplianceRegistry");
    registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();

    // Grant roles
    const ORACLE_ROLE = await registry.ORACLE_ROLE();
    const COMPLIANCE_OFFICER_ROLE = await registry.COMPLIANCE_OFFICER_ROLE();

    await registry.grantOracleRole(oracle.address);
    await registry.grantRole(COMPLIANCE_OFFICER_ROLE, complianceOfficer.address);

    // Deploy RWAToken with registry
    const TokenFactory = await ethers.getContractFactory("RWAToken");
    token = await TokenFactory.deploy(
      "Test Treasury Token",
      "TTT",
      18,
      "TREASURY",
      ethers.parseEther("1000000"),
      await registry.getAddress()
    );
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct ruleset version", async function () {
      expect(await registry.RULESET_VERSION()).to.equal("1.0.0");
    });

    it("Should grant admin role to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
      expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should have all investors UNAUTHORIZED by default", async function () {
      expect(await registry.getStatusAsUint(alice.address)).to.equal(Status.UNAUTHORIZED);
      expect(await registry.getStatusAsUint(bob.address)).to.equal(Status.UNAUTHORIZED);
    });
  });

  describe("Status Management", function () {
    it("Should allow compliance officer to update single status", async function () {
      await registry.connect(complianceOfficer).updateStatus(alice.address, Status.APPROVED);

      expect(await registry.getStatusAsUint(alice.address)).to.equal(Status.APPROVED);
    });

    it("Should emit StatusUpdated event", async function () {
      await expect(registry.connect(complianceOfficer).updateStatus(alice.address, Status.APPROVED))
        .to.emit(registry, "StatusUpdated")
        .withArgs(alice.address, Status.UNAUTHORIZED, Status.APPROVED, complianceOfficer.address);
    });

    it("Should allow oracle to batch update statuses", async function () {
      const investors = [alice.address, bob.address, charlie.address];
      const statuses = [Status.APPROVED, Status.GRANDFATHERED, Status.FROZEN];

      await registry.connect(oracle).batchUpdateStatus(investors, statuses);

      expect(await registry.getStatusAsUint(alice.address)).to.equal(Status.APPROVED);
      expect(await registry.getStatusAsUint(bob.address)).to.equal(Status.GRANDFATHERED);
      expect(await registry.getStatusAsUint(charlie.address)).to.equal(Status.FROZEN);
    });

    it("Should track last updated block", async function () {
      await registry.connect(complianceOfficer).updateStatus(alice.address, Status.APPROVED);

      const [status, updatedBlock] = await registry.getStatus(alice.address);
      expect(status).to.equal(Status.APPROVED);
      expect(updatedBlock).to.be.gt(0);
    });

    it("Should reject batch with mismatched array lengths", async function () {
      const investors = [alice.address, bob.address];
      const statuses = [Status.APPROVED]; // Only one status

      await expect(
        registry.connect(oracle).batchUpdateStatus(investors, statuses)
      ).to.be.revertedWith("ComplianceRegistry: length mismatch");
    });

    it("Should reject batch larger than 100", async function () {
      const investors = Array(101).fill(alice.address);
      const statuses = Array(101).fill(Status.APPROVED);

      await expect(
        registry.connect(oracle).batchUpdateStatus(investors, statuses)
      ).to.be.revertedWith("ComplianceRegistry: batch too large");
    });

    it("Should reject zero address", async function () {
      await expect(
        registry.connect(complianceOfficer).updateStatus(ethers.ZeroAddress, Status.APPROVED)
      ).to.be.revertedWith("ComplianceRegistry: zero address");
    });
  });

  describe("Directional Compliance - canTransfer", function () {
    beforeEach(async function () {
      // Setup: Alice APPROVED, Bob GRANDFATHERED, Charlie FROZEN
      await registry.connect(oracle).batchUpdateStatus(
        [alice.address, bob.address, charlie.address],
        [Status.APPROVED, Status.GRANDFATHERED, Status.FROZEN]
      );
    });

    describe("APPROVED sender", function () {
      it("Should allow APPROVED -> APPROVED", async function () {
        const [allowed, reason] = await registry.canTransfer(alice.address, alice.address, 100);
        expect(allowed).to.be.true;
      });

      it("Should block APPROVED -> GRANDFATHERED (recipient cannot add position)", async function () {
        const [allowed, reason] = await registry.canTransfer(alice.address, bob.address, 100);
        expect(allowed).to.be.false;
        expect(reason).to.equal(await registry.REASON_RECIPIENT_GRANDFATHERED());
      });

      it("Should block APPROVED -> FROZEN", async function () {
        const [allowed, reason] = await registry.canTransfer(alice.address, charlie.address, 100);
        expect(allowed).to.be.false;
        expect(reason).to.equal(await registry.REASON_RECIPIENT_FROZEN());
      });

      it("Should block APPROVED -> UNAUTHORIZED", async function () {
        const unauthorized = owner.address; // Owner not set up as investor
        const [allowed, reason] = await registry.canTransfer(alice.address, unauthorized, 100);
        expect(allowed).to.be.false;
        expect(reason).to.equal(await registry.REASON_RECIPIENT_UNAUTHORIZED());
      });
    });

    describe("GRANDFATHERED sender (sell-only)", function () {
      it("Should allow GRANDFATHERED -> APPROVED (can exit position)", async function () {
        const [allowed, reason] = await registry.canTransfer(bob.address, alice.address, 100);
        expect(allowed).to.be.true;
      });

      it("Should block GRANDFATHERED -> GRANDFATHERED", async function () {
        // Create another grandfathered user
        await registry.connect(complianceOfficer).updateStatus(owner.address, Status.GRANDFATHERED);

        const [allowed, reason] = await registry.canTransfer(bob.address, owner.address, 100);
        expect(allowed).to.be.false;
      });

      it("Should block GRANDFATHERED -> FROZEN", async function () {
        const [allowed, reason] = await registry.canTransfer(bob.address, charlie.address, 100);
        expect(allowed).to.be.false;
      });
    });

    describe("FROZEN sender (complete block)", function () {
      it("Should block FROZEN -> any status", async function () {
        // FROZEN -> APPROVED
        let [allowed, reason] = await registry.canTransfer(charlie.address, alice.address, 100);
        expect(allowed).to.be.false;
        expect(reason).to.equal(await registry.REASON_SENDER_FROZEN());

        // FROZEN -> GRANDFATHERED
        [allowed, reason] = await registry.canTransfer(charlie.address, bob.address, 100);
        expect(allowed).to.be.false;
        expect(reason).to.equal(await registry.REASON_SENDER_FROZEN());
      });
    });

    describe("UNAUTHORIZED sender", function () {
      it("Should block UNAUTHORIZED -> any status", async function () {
        const unauthorized = owner.address;

        const [allowed, reason] = await registry.canTransfer(unauthorized, alice.address, 100);
        expect(allowed).to.be.false;
        expect(reason).to.equal(await registry.REASON_SENDER_UNAUTHORIZED());
      });
    });
  });

  describe("Helper Functions", function () {
    beforeEach(async function () {
      await registry.connect(oracle).batchUpdateStatus(
        [alice.address, bob.address],
        [Status.APPROVED, Status.GRANDFATHERED]
      );
    });

    it("Should correctly report canSend", async function () {
      expect(await registry.canSend(alice.address)).to.be.true; // APPROVED
      expect(await registry.canSend(bob.address)).to.be.true; // GRANDFATHERED can still sell
      expect(await registry.canSend(charlie.address)).to.be.false; // UNAUTHORIZED
    });

    it("Should correctly report canReceive", async function () {
      expect(await registry.canReceive(alice.address)).to.be.true; // APPROVED
      expect(await registry.canReceive(bob.address)).to.be.false; // GRANDFATHERED cannot buy
      expect(await registry.canReceive(charlie.address)).to.be.false; // UNAUTHORIZED
    });

    it("Should correctly report isWhitelisted", async function () {
      expect(await registry.isWhitelisted(alice.address)).to.be.true;
      expect(await registry.isWhitelisted(bob.address)).to.be.true; // Grandfathered is whitelisted
      expect(await registry.isWhitelisted(charlie.address)).to.be.false;
    });

    it("Should correctly report isAccredited", async function () {
      expect(await registry.isAccredited(alice.address)).to.be.true;
      expect(await registry.isAccredited(bob.address)).to.be.false; // Only APPROVED is accredited
    });

    it("Should batch get statuses", async function () {
      const statuses = await registry.batchGetStatus([alice.address, bob.address, charlie.address]);

      expect(statuses[0]).to.equal(Status.APPROVED);
      expect(statuses[1]).to.equal(Status.GRANDFATHERED);
      expect(statuses[2]).to.equal(Status.UNAUTHORIZED);
    });
  });

  describe("Access Control", function () {
    it("Should reject updateStatus from non-compliance officer", async function () {
      await expect(
        registry.connect(alice).updateStatus(bob.address, Status.APPROVED)
      ).to.be.reverted;
    });

    it("Should reject batchUpdateStatus from non-oracle", async function () {
      await expect(
        registry.connect(alice).batchUpdateStatus([bob.address], [Status.APPROVED])
      ).to.be.reverted;
    });

    it("Should allow admin to grant/revoke oracle role", async function () {
      await registry.grantOracleRole(alice.address);
      const ORACLE_ROLE = await registry.ORACLE_ROLE();
      expect(await registry.hasRole(ORACLE_ROLE, alice.address)).to.be.true;

      await registry.revokeOracleRole(alice.address);
      expect(await registry.hasRole(ORACLE_ROLE, alice.address)).to.be.false;
    });
  });

  describe("Pausable", function () {
    it("Should allow admin to pause", async function () {
      await registry.pause();
      expect(await registry.paused()).to.be.true;
    });

    it("Should block status updates when paused", async function () {
      await registry.pause();

      await expect(
        registry.connect(complianceOfficer).updateStatus(alice.address, Status.APPROVED)
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });

    it("Should allow admin to unpause", async function () {
      await registry.pause();
      await registry.unpause();
      expect(await registry.paused()).to.be.false;
    });
  });
});

describe("RWAToken with Compliance", function () {
  let registry: ComplianceRegistry;
  let token: RWAToken;
  let owner: SignerWithAddress;
  let oracle: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  const Status = {
    UNAUTHORIZED: 0,
    APPROVED: 1,
    GRANDFATHERED: 2,
    FROZEN: 3,
  };

  beforeEach(async function () {
    [owner, oracle, alice, bob, charlie] = await ethers.getSigners();

    // Deploy ComplianceRegistry
    const RegistryFactory = await ethers.getContractFactory("ComplianceRegistry");
    registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();

    // Grant oracle role
    await registry.grantOracleRole(oracle.address);

    // Deploy RWAToken
    const TokenFactory = await ethers.getContractFactory("RWAToken");
    token = await TokenFactory.deploy(
      "Test Treasury Token",
      "TTT",
      18,
      "TREASURY",
      ethers.parseEther("1000000"),
      await registry.getAddress()
    );
    await token.waitForDeployment();

    // Step 1: First, approve everyone so we can distribute tokens
    await registry.connect(oracle).batchUpdateStatus(
      [owner.address, alice.address, bob.address, charlie.address],
      [Status.APPROVED, Status.APPROVED, Status.APPROVED, Status.APPROVED]
    );

    // Step 2: Distribute tokens while all are APPROVED
    await token.transfer(alice.address, ethers.parseEther("10000"));
    await token.transfer(bob.address, ethers.parseEther("5000"));

    // Step 3: NOW change Bob to GRANDFATHERED and Charlie to FROZEN
    // This simulates a regulatory change AFTER they already hold tokens
    await registry.connect(oracle).batchUpdateStatus(
      [bob.address, charlie.address],
      [Status.GRANDFATHERED, Status.FROZEN]
    );
  });

  describe("Compliant Transfers", function () {
    it("Should allow APPROVED -> APPROVED transfer", async function () {
      await expect(
        token.connect(alice).transfer(owner.address, ethers.parseEther("100"))
      ).to.not.be.reverted;
    });

    it("Should allow GRANDFATHERED -> APPROVED transfer (exit position)", async function () {
      await expect(
        token.connect(bob).transfer(alice.address, ethers.parseEther("100"))
      ).to.not.be.reverted;
    });
  });

  describe("Blocked Transfers", function () {
    it("Should block APPROVED -> GRANDFATHERED transfer", async function () {
      await expect(
        token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "TransferNotCompliant");
    });

    it("Should block APPROVED -> FROZEN transfer", async function () {
      await expect(
        token.connect(alice).transfer(charlie.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "TransferNotCompliant");
    });

    it("Should block APPROVED -> UNAUTHORIZED transfer", async function () {
      const unauthorized = (await ethers.getSigners())[5];

      await expect(
        token.connect(alice).transfer(unauthorized.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "TransferNotCompliant");
    });
  });

  describe("detectTransferRestriction (ERC-1404)", function () {
    it("Should return SUCCESS (0) for compliant transfer", async function () {
      const code = await token.detectTransferRestriction(
        alice.address,
        owner.address,
        ethers.parseEther("100")
      );
      expect(code).to.equal(0);
    });

    it("Should return RECIPIENT_NOT_COMPLIANT for grandfathered recipient", async function () {
      const code = await token.detectTransferRestriction(
        alice.address,
        bob.address,
        ethers.parseEther("100")
      );
      expect(code).to.equal(2); // RECIPIENT_NOT_COMPLIANT
    });

    it("Should return meaningful message for restriction code", async function () {
      const message = await token.messageForTransferRestriction(2);
      expect(message).to.include("Recipient not compliant");
    });
  });

  describe("Minting and Burning", function () {
    it("Should allow minting to APPROVED address", async function () {
      await token.mint(alice.address, ethers.parseEther("1000"));
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("11000"));
    });

    it("Should allow burning by token holder", async function () {
      await token.connect(alice).burn(ethers.parseEther("100"));
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("9900"));
    });
  });

  describe("Pausable", function () {
    it("Should block transfers when paused", async function () {
      await token.pause();

      await expect(
        token.connect(alice).transfer(owner.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("Should detect TRANSFER_PAUSED in restriction check", async function () {
      await token.pause();

      const code = await token.detectTransferRestriction(
        alice.address,
        owner.address,
        ethers.parseEther("100")
      );
      expect(code).to.equal(3); // TRANSFER_PAUSED
    });
  });
});

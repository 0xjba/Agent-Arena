const { ethers } = require("hardhat");
const hre = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  const network = hre.network;
  console.log("Network:", network.name);
  
  // Display deployer balance
  const balance = await deployer.getBalance();
  console.log("Deployer balance:", ethers.utils.formatEther(balance), "ETH");
  
  // Determine which version we're deploying
  const useVanilla = true; // Set to false if you want to deploy the AI versions
  console.log(`Deploying ${useVanilla ? "vanilla" : "AI"} version of contracts`);
  
  // Transaction options with higher gas settings for TEN network
  const extremeGasTxOptions = {
    gasLimit: 30000000 // Very high gas limit for deployments
  };
  
  // First, deploy CardLibrary
  console.log("1. Deploying CardLibrary...");
  const CardLibraryFactory = await ethers.getContractFactory(
    useVanilla ? "contracts/vanilla/PokerCardLibrary.sol:CardLibrary" : "contracts/AI/PokerCardLibrary.sol:CardLibrary", 
    { signer: deployer }
  );
  const cardLibrary = await CardLibraryFactory.deploy(extremeGasTxOptions);
  await cardLibrary.deployed();
  console.log("   - CardLibrary deployed to:", cardLibrary.address);

  // Next, deploy GameLibrary
  console.log("2. Deploying GameLibrary...");
  const GameLibraryFactory = await ethers.getContractFactory(
    useVanilla ? "contracts/vanilla/PokerGameLibrary.sol:GameLibrary" : "contracts/AI/PokerGameLibrary.sol:GameLibrary", 
    { signer: deployer }
  );
  const gameLibrary = await GameLibraryFactory.deploy(extremeGasTxOptions);
  await gameLibrary.deployed();
  console.log("   - GameLibrary deployed to:", gameLibrary.address);

  // Deploy main contract - OneCard without linking libraries
  console.log("3. Deploying OneCard main contract...");
  const OneCardFactory = await ethers.getContractFactory(
    useVanilla ? "contracts/vanilla/OneCard.sol:OneCard" : "contracts/AI/OneCard.sol:OneCard", 
    { signer: deployer }
  );
  const oneCardContract = await OneCardFactory.deploy(extremeGasTxOptions);
  await oneCardContract.deployed();
  console.log("   - OneCard deployed to:", oneCardContract.address);

  // Step 4: Deploy SpectatorBetting if using AI version
  let spectatorBettingContract = { address: "Not deployed - vanilla version" };
  if (!useVanilla) {
    console.log("4. Deploying SpectatorBetting...");
    const SpectatorBettingFactory = await ethers.getContractFactory(
      "contracts/AI/SpectatorBetting.sol:SpectatorBetting",
      { signer: deployer }
    );
    spectatorBettingContract = await SpectatorBettingFactory.deploy(oneCardContract.address, extremeGasTxOptions);
    await spectatorBettingContract.deployed();
    console.log("   - SpectatorBetting deployed to:", spectatorBettingContract.address);
  }

  // For vanilla version, we'll skip SpectatorBetting/View deployment
  console.log("\nAll contracts deployed successfully!");
  console.log("------------------------------------");
  console.log("Network:               ", network.name);
  console.log("CardLibrary:           ", cardLibrary.address);
  console.log("GameLibrary:           ", gameLibrary.address);
  console.log("OneCard:               ", oneCardContract.address);
  if (!useVanilla) {
    console.log("SpectatorBetting:      ", spectatorBettingContract.address);
  }
  console.log("------------------------------------");
  
  // Save to deployment file for easy access
  const fs = require("fs");
  const deploymentData = {
    network: network.name,
    timestamp: new Date().toISOString(),
    contracts: {
      CardLibrary: cardLibrary.address,
      GameLibrary: gameLibrary.address,
      OneCard: oneCardContract.address,
    }
  };
  
  if (!useVanilla) {
    deploymentData.contracts.SpectatorBetting = spectatorBettingContract.address;
  }
  
  fs.writeFileSync(
    `deployment-${network.name}-${new Date().toISOString().split('T')[0]}.json`,
    JSON.stringify(deploymentData, null, 2)
  );
  console.log(`Deployment info saved to deployment-${network.name}-${new Date().toISOString().split('T')[0]}.json`);
  
  // Add the keeper to the contract if we're on testnet
  if (network.name !== 'hardhat' && network.name !== 'localhost') {
    try {
      const keeperPrivateKey = process.env.KEEPER_PRIVATE_KEY;
      if (keeperPrivateKey) {
        const keeperWallet = new ethers.Wallet(keeperPrivateKey, ethers.provider);
        console.log("Adding keeper address to contract:", keeperWallet.address);
        
        const tx = await oneCardContract.connect(deployer).addKeeper(keeperWallet.address);
        await tx.wait();
        console.log("Keeper added successfully!");
      } else {
        console.log("KEEPER_PRIVATE_KEY not found in .env - skipping keeper setup");
      }
    } catch (error) {
      console.error("Error adding keeper:", error.message);
    }
  }
  
  console.log("\nNext steps:");
  console.log("1. Update your frontend config with these contract addresses");
  console.log("2. Start the keeper service using the keeper private key and contract address:");
  console.log(`   node js-keeper/keeper-service.js ${oneCardContract.address}`);
  console.log("3. Use the OneCard contract address for player interactions");
  console.log("4. Cards will be publicly revealed at game end through the CardRevealed event");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
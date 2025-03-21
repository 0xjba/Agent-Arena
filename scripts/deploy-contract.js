const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Step 1: Deploy the CardLibrary
  console.log("1. Deploying CardLibrary...");
  const CardLibrary = await ethers.getContractFactory("CardLibrary");
  const cardLibrary = await CardLibrary.deploy();
  await cardLibrary.deployed();
  console.log("   - CardLibrary deployed to:", cardLibrary.address);

  // Step 2: Deploy the GameLibrary
  console.log("2. Deploying GameLibrary...");
  const GameLibrary = await ethers.getContractFactory("GameLibrary");
  const gameLibrary = await GameLibrary.deploy();
  await gameLibrary.deployed();
  console.log("   - GameLibrary deployed to:", gameLibrary.address);

  // Step 3: Deploy the main OneCard contract with library references
  console.log("3. Deploying OneCard...");
  const OneCard = await ethers.getContractFactory("OneCard", {
    libraries: {
      CardLibrary: cardLibrary.address,
      GameLibrary: gameLibrary.address,
    },
  });
  const pokerContract = await OneCard.deploy();
  await pokerContract.deployed();
  console.log("   - OneCard deployed to:", pokerContract.address);

  // Step 4: Deploy the SpectatorView contract with main contract reference
  console.log("4. Deploying PokerSpectatorView...");
  const PokerSpectatorView = await ethers.getContractFactory("PokerSpectatorView");
  const spectatorContract = await PokerSpectatorView.deploy(pokerContract.address);
  await spectatorContract.deployed();
  console.log("   - PokerSpectatorView deployed to:", spectatorContract.address);

  console.log("\nAll contracts deployed successfully!");
  console.log("------------------------------------");
  console.log("CardLibrary:          ", cardLibrary.address);
  console.log("GameLibrary:          ", gameLibrary.address);
  console.log("OneCard:   ", pokerContract.address);
  console.log("PokerSpectatorView:   ", spectatorContract.address);
  console.log("------------------------------------");
  console.log("Next steps:");
  console.log("1. Update your frontend to use these contract addresses");
  console.log("2. Configure players to use OneCard address");
  console.log("3. Configure spectators to use PokerSpectatorView address");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
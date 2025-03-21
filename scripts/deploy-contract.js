const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying HiddenOneCardPoker with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  const PokerFactory = await ethers.getContractFactory("OneCard");
  console.log("Deploying contract...");
  
  const pokerContract = await PokerFactory.deploy();
  
  // Wait for deployment to complete
  console.log("Waiting for deployment transaction to be mined...");
  await pokerContract.deployed();
  
  console.log("OneCard Poker deployed to:", pokerContract.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
  
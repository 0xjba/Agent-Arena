require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.0",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    ten: {
      url: process.env.TEN_RPC_URL || "",
      accounts: 
        process.env.OWNER_PRIVATE_KEY ? [
          process.env.OWNER_PRIVATE_KEY,
          process.env.PLAYER1_PRIVATE_KEY, 
          process.env.PLAYER2_PRIVATE_KEY, 
          process.env.PLAYER3_PRIVATE_KEY, 
          process.env.PLAYER4_PRIVATE_KEY,
          process.env.KEEPER_PRIVATE_KEY
        ].filter(key => key) : [],
      timeout: 600000 
    },
    hardhat: {
      mining: {
        auto: true,
        interval: 1000
      }
    }
  },
  mocha: {
    timeout: 600000 
  }
};
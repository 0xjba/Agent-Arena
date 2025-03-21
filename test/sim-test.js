const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Configure logging
const logPath = path.join(__dirname, "poker-game-log.txt");
let logStream = fs.createWriteStream(logPath, { flags: "a" });

function log(message) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}\n`;
  logStream.write(formattedMessage);
  console.log(message);
}

// Card helper functions
function getCardValueName(value) {
  if (value >= 2 && value <= 10) return value.toString();
  if (value === 11) return "Jack";
  if (value === 12) return "Queen";
  if (value === 13) return "King";
  if (value === 14) return "Ace";
  return "Unknown";
}

function getCardSuitName(suit) {
  const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
  return suits[suit] || "Unknown";
}

function formatCard(value, suit) {
  return `${getCardValueName(value)} of ${getCardSuitName(suit)}`;
}

// GameState enum mapping
const GameState = {
  0: "REGISTRATION",
  1: "PEEK_PHASE",
  2: "BETTING",
  3: "SHOWDOWN",
  4: "ENDED"
};

// Function to set up wallets from .env file
async function setupWallets(provider) {
  const wallets = [];
  
  // Check for required environment variables
  if (!process.env.OWNER_PRIVATE_KEY) {
    throw new Error("OWNER_PRIVATE_KEY is required in .env file");
  }
  
  // Owner wallet
  const ownerWallet = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, provider);
  wallets.push(ownerWallet);
  
  // Player wallets
  for (let i = 1; i <= 4; i++) {
    const privateKeyVar = `PLAYER${i}_PRIVATE_KEY`;
    if (!process.env[privateKeyVar]) {
      throw new Error(`${privateKeyVar} is required in .env file`);
    }
    const playerWallet = new ethers.Wallet(process.env[privateKeyVar], provider);
    wallets.push(playerWallet);
  }
  
  // Keeper wallet (if different from owner)
  if (process.env.KEEPER_PRIVATE_KEY && process.env.KEEPER_PRIVATE_KEY !== process.env.OWNER_PRIVATE_KEY) {
    const keeperWallet = new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY, provider);
    wallets.push(keeperWallet);
  }
  
  return wallets;
}

describe("HiddenOneCardPoker Full Game Test on ten", function() {
  // Increase timeout for ten interactions
  this.timeout(600000); // 10 minutes

  let pokerContract;
  let owner;
  let keeper;
  let players = [];
  let gameId;
  let playerCards = {};
  let contractAddress;
  
  // Standard transaction options with fixed gas settings for regular operations
  const txOptions = {
    gasLimit: 500000 // 500k gas for regular transactions
  };
  
  // Higher gas limits for complex operations
  const highGasTxOptions = {
    gasLimit: 2000000 // 2 million gas for complex operations
  };
  
  // Extra high gas limits for very complex operations
  const veryHighGasTxOptions = {
    gasLimit: 8000000 // 8 million gas for very complex operations (increased from 5 million)
  };

  const extremelyHighGasTxOptions = {
    gasLimit: 15000000 // 15 million gas
  };
  
  before(async function() {
    log("\n===== SETTING UP TEST ENVIRONMENT =====");
    
    // Set up wallets from .env
    const provider = ethers.provider;
    const wallets = await setupWallets(provider);
    
    // First wallet is owner
    owner = wallets[0];
    
    // Player wallets (next 4)
    players = wallets.slice(1, 5);
    
    // Keeper is either a separate wallet or same as owner
    keeper = wallets.length > 5 ? wallets[5] : owner;
    
    log("Wallet setup complete.");
    log(`Owner address: ${owner.address}`);
    players.forEach((player, index) => {
      log(`Player ${index + 1} address: ${player.address}`);
    });
    log(`Keeper address: ${keeper.address}`);
    
    // Check wallet balances
    log("\n----- CHECKING WALLET BALANCES -----");
    for (const wallet of [owner, ...players, keeper]) {
      const balance = await wallet.getBalance();
      const ethBalance = ethers.utils.formatEther(balance);
      log(`Address ${wallet.address} has ${ethBalance} ETH`);
      
      // Warn if balance is too low
      if (parseFloat(ethBalance) < 0.01) {
        log(`WARNING: Address ${wallet.address} has low balance. Please fund with ten ETH.`);
      }
    }
    
    // Check if CONTRACT_ADDRESS is provided in .env
    if (process.env.CONTRACT_ADDRESS) {
      log(`\nUsing existing contract at: ${process.env.CONTRACT_ADDRESS}`);
      contractAddress = process.env.CONTRACT_ADDRESS;
      const PokerFactory = await ethers.getContractFactory("HiddenOneCardPoker");
      pokerContract = PokerFactory.attach(contractAddress);
    } else {
      // Deploy the contract with fixed gas settings
      log("\n----- DEPLOYING CONTRACT -----");
      const PokerFactory = await ethers.getContractFactory("HiddenOneCardPoker");
      
      // Get current gas price
      const gasPrice = await ethers.provider.getGasPrice();
      // Adding a 20% buffer for gas price fluctuations
      const adjustedGasPrice = gasPrice.mul(120).div(100);
      
      log(`Current gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
      log(`Using adjusted gas price: ${ethers.utils.formatUnits(adjustedGasPrice, "gwei")} gwei`);
      
      // Set explicit high gas limit for deployment
      const deployOptions = {
        gasPrice: adjustedGasPrice,
        gasLimit: 5000000 // 5 million gas should be plenty for deployment
      };
      
      log(`Deploying with gas limit: ${deployOptions.gasLimit.toString()}`);
      
      try {
        // Deploy the contract
        log("Sending deployment transaction...");
        const deployTx = await PokerFactory.deploy(deployOptions);
        log("Waiting for deployment to be confirmed...");
        await deployTx.deployed();
        pokerContract = deployTx;
        contractAddress = pokerContract.address;
        log(`Contract successfully deployed at address: ${contractAddress}`);
        log(`Add to .env: CONTRACT_ADDRESS=${contractAddress}`);
      } catch (error) {
        log(`Deployment failed with error: ${error.message}`);
        throw error;
      }
    }
  });
  
  it("Should play a complete game of poker", async function() {
    log("\n===== STARTING HIDDEN ONE CARD POKER GAME TEST =====");
    
    // Add keeper if different from owner
    if (keeper.address !== owner.address) {
      log("\n----- ADDING KEEPER -----");
      const addKeeperTx = await pokerContract.connect(owner).addKeeper(keeper.address, txOptions);
      await addKeeperTx.wait();
      log(`Added ${keeper.address} as a keeper`);
    }
    
    // Add players to whitelist
    log("\n----- ADDING PLAYERS TO WHITELIST -----");
    const playerAddresses = players.map(player => player.address);
    const tx = await pokerContract.connect(owner).addMultipleToWhitelist(playerAddresses, highGasTxOptions);
    await tx.wait();
    log(`Added ${players.length} players to whitelist`);
    
    // Create a new game
    log("\n----- CREATING A NEW GAME -----");
    const createTx = await pokerContract.connect(keeper).createGame(txOptions);
    const createReceipt = await createTx.wait();
    
    // Extract gameId from the event logs
    const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
    gameId = gameCreatedEvent.args.gameId.toNumber();
    log(`Created Game with ID: ${gameId}`);
    
    // Players join the game
    log("\n----- PLAYERS JOINING THE GAME -----");
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const joinTx = await pokerContract.connect(player).joinGame(gameId, txOptions);
      await joinTx.wait();
      log(`Player ${i + 1} (${player.address}) joined the game`);
    }
    
    // Verify game state before starting peek phase
    log("\n----- VERIFYING GAME STATE BEFORE STARTING PEEK PHASE -----");
    try {
      // Check if the keeper is authorized
      const isKeeper = await pokerContract.isKeeper(keeper.address);
      log(`Is ${keeper.address} an authorized keeper? ${isKeeper}`);
      
      // Check the game state
      const gameState = await pokerContract.getGameState(gameId);
      log(`Game ${gameId} state: ${GameState[gameState.state]}`);
      log(`Game ${gameId} player count: ${gameState.playerCount.toString()}`);
      
      // List all players in the game
      log("Players in the game:");
      try {
        for (let i = 0; i < gameState.playerAddresses.length; i++) {
          log(`- Player ${i+1}: ${gameState.playerAddresses[i]}`);
        }
      } catch (error) {
        log(`Error listing player addresses: ${error.message}`);
      }
    } catch (error) {
      log(`Error verifying game state: ${error.message}`);
    }
    
    // Start the peek phase with higher gas limit
    log("\n----- STARTING PEEK PHASE -----");
    let peekPhaseEndTime = 0; // Initialize to avoid reference error
    let peekPhaseDuration = 0;
    
    try {
      const startPeekTx = await pokerContract.connect(keeper).startPeekPhase(gameId, veryHighGasTxOptions);
      log("startPeekPhase transaction submitted, waiting for confirmation...");
      const startPeekReceipt = await startPeekTx.wait();
      log("startPeekPhase transaction confirmed!");
      
      const peekPhaseEvent = startPeekReceipt.events.find(e => e.event === "PeekPhaseStarted");
      if (peekPhaseEvent) {
        peekPhaseDuration = peekPhaseEvent.args.duration.toNumber();
        peekPhaseEndTime = peekPhaseEvent.args.endTime.toNumber();
        log(`Peek phase started: Duration = ${peekPhaseDuration} seconds, End time = ${new Date(peekPhaseEndTime * 1000).toISOString()}`);
      } else {
        log("WARNING: PeekPhaseStarted event not found in logs");
      }
    } catch (error) {
      log(`Error starting peek phase: ${error.message}`);
      // If it's a gas error, suggest increasing gas limit further
      if (error.message.includes("gas") || error.message.includes("always failing transaction")) {
        log("This appears to be a gas-related issue. Try increasing the gas limit further.");
      }
      throw error;
    }
    
    // Set up event listener for CardRevealed events
    pokerContract.on("CardRevealed", async (player, value, suit) => {
      const cardString = formatCard(Number(value), Number(suit));
      playerCards[player] = { value, suit, cardString };
      log(`Card for ${player}: ${cardString}`);
    });
    
    // Players peek at their cards
    log("\n----- PLAYERS PEEKING AT CARDS -----");
    // Store initial chip balances for comparison later
    const initialChipBalances = {};
    
    for (let i = 0; i < players.length - 1; i++) { // Last player won't peek
      const player = players[i];
      try {
        const peekTx = await pokerContract.connect(player).peekAtCard(gameId, highGasTxOptions);
        await peekTx.wait();
        log(`Player ${i + 1} (${player.address}) peeked at their card`);
        
        // Get chip balance after peeking
        const chipBalance = await pokerContract.getChipBalance(gameId, player.address);
        initialChipBalances[player.address] = chipBalance;
        log(`Player ${i + 1} chip balance after peeking: ${chipBalance}`);
      } catch (error) {
        log(`Error when Player ${i + 1} tried to peek: ${error.message}`);
      }
    }
    
    // Also store the balance of player who didn't peek
    try {
      const lastPlayerBalance = await pokerContract.getChipBalance(gameId, players[players.length-1].address);
      initialChipBalances[players[players.length-1].address] = lastPlayerBalance;
    } catch (error) {
      log(`Error getting balance for Player ${players.length}: ${error.message}`);
    }
    
    log(`Player ${players.length} (${players[players.length - 1].address}) chose not to peek`);
    
    // One player decides to swap their card
    log("\n----- PLAYER SWAPPING CARD -----");
    const swappingPlayer = players[0];
    try {
      const swapTx = await pokerContract.connect(swappingPlayer).swapCard(gameId, highGasTxOptions);
      await swapTx.wait();
      log(`Player 1 (${swappingPlayer.address}) swapped their card`);
      
      const chipBalanceAfterSwap = await pokerContract.getChipBalance(gameId, swappingPlayer.address);
      log(`Player 1 chip balance after swapping: ${chipBalanceAfterSwap}`);
    } catch (error) {
      log(`Error when Player 1 tried to swap card: ${error.message}`);
    }
    
    // End peek phase and start betting phase
    log("\n----- WAITING FOR PEEK PHASE TO END -----");
    log(`Current time: ${new Date().toISOString()}`);
    
    if (peekPhaseEndTime > 0) {
      log(`Peek phase ends: ${new Date(peekPhaseEndTime * 1000).toISOString()}`);
      
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const timeRemaining = peekPhaseEndTime - currentTimestamp;
      
      if (timeRemaining > 0) {
        log(`Waiting ${timeRemaining} seconds for peek phase to end...`);
        log("(If this is too long, consider modifying the contract's PEEK_PHASE_DURATION for testing)");
        
        // On ten, we actually have to wait
        if (network.name === "ten") {
          // Option to wait manually
          log("Press Ctrl+C to exit if you want to wait manually and resume the test later");
          log("Otherwise, the test will continue when the peek phase ends");
          
          // Wait until the peek phase ends
          while (Math.floor(Date.now() / 1000) < peekPhaseEndTime) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const currentTime = Math.floor(Date.now() / 1000);
            const remaining = peekPhaseEndTime - currentTime;
            if (remaining > 0 && remaining % 15 === 0) {
              log(`${remaining} seconds remaining in peek phase`);
            }
          }
        } else {
          // On local networks, we can advance time
          try {
            await ethers.provider.send("evm_increaseTime", [timeRemaining + 5]);
            await ethers.provider.send("evm_mine");
            log("Time advanced successfully");
          } catch (error) {
            log(`Error advancing time: ${error.message}`);
            log("Continuing test assuming time has passed.");
          }
        }
      }
    } else {
      log("WARNING: peekPhaseEndTime is not available. Cannot determine when peek phase ends.");
      log("Waiting for 30 seconds as a fallback...");
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    
    log("\n----- ENDING PEEK PHASE -----");
    let bettingPhaseEndTime = 0;
    
    try {
      const endPeekTx = await pokerContract.connect(keeper).endPeekPhase(gameId, veryHighGasTxOptions);
      log("endPeekPhase transaction submitted, waiting for confirmation...");
      const endPeekReceipt = await endPeekTx.wait();
      log("endPeekPhase transaction confirmed!");
      
      const bettingPhaseEvent = endPeekReceipt.events.find(e => e.event === "BettingPhaseStarted");
      if (bettingPhaseEvent) {
        const bettingPhaseDuration = bettingPhaseEvent.args.duration.toNumber();
        bettingPhaseEndTime = bettingPhaseEvent.args.endTime.toNumber();
        log(`Betting phase started: Duration = ${bettingPhaseDuration} seconds, End time = ${new Date(bettingPhaseEndTime * 1000).toISOString()}`);
      } else {
        log("WARNING: BettingPhaseStarted event not found in logs");
      }
      
      // Players place bets
      log("\n----- PLAYERS PLACING BETS -----");
      
      // First player places a bet
      const bet1Amount = 5;
      try {
        const bet1Tx = await pokerContract.connect(players[0]).placeBet(gameId, bet1Amount, highGasTxOptions);
        await bet1Tx.wait();
        log(`Player 1 (${players[0].address}) bet ${bet1Amount} chips`);
      } catch (error) {
        log(`Error when Player 1 tried to bet: ${error.message}`);
      }
      
      // Second player calls
      const bet2Amount = 5;
      try {
        const bet2Tx = await pokerContract.connect(players[1]).placeBet(gameId, bet2Amount, highGasTxOptions);
        await bet2Tx.wait();
        log(`Player 2 (${players[1].address}) bet ${bet2Amount} chips`);
      } catch (error) {
        log(`Error when Player 2 tried to bet: ${error.message}`);
      }
      
      // Third player raises
      const bet3Amount = 10;
      try {
        const bet3Tx = await pokerContract.connect(players[2]).placeBet(gameId, bet3Amount, highGasTxOptions);
        await bet3Tx.wait();
        log(`Player 3 (${players[2].address}) bet ${bet3Amount} chips (raising to 10)`);
      } catch (error) {
        log(`Error when Player 3 tried to bet: ${error.message}`);
      }
      
      // First player calls the raise
      const bet4Amount = 5; // Additional 5 to match the 10 total
      try {
        const bet4Tx = await pokerContract.connect(players[0]).placeBet(gameId, bet4Amount, highGasTxOptions);
        await bet4Tx.wait();
        log(`Player 1 (${players[0].address}) bet additional ${bet4Amount} chips (calling the raise)`);
      } catch (error) {
        log(`Error when Player 1 tried to call the raise: ${error.message}`);
      }
      
      // Second player calls the raise
      const bet5Amount = 5; // Additional 5 to match the 10 total
      try {
        const bet5Tx = await pokerContract.connect(players[1]).placeBet(gameId, bet5Amount, highGasTxOptions);
        await bet5Tx.wait();
        log(`Player 2 (${players[1].address}) bet additional ${bet5Amount} chips (calling the raise)`);
      } catch (error) {
        log(`Error when Player 2 tried to call the raise: ${error.message}`);
      }
      
      // Fourth player folds
      try {
        const foldTx = await pokerContract.connect(players[3]).fold(gameId, highGasTxOptions);
        await foldTx.wait();
        log(`Player 4 (${players[3].address}) folded`);
      } catch (error) {
        log(`Error when Player 4 tried to fold: ${error.message}`);
      }
      
      // End betting phase and go to showdown
      log("\n----- WAITING FOR BETTING PHASE TO END -----");
      
      if (bettingPhaseEndTime > 0) {
        log(`Betting phase ends: ${new Date(bettingPhaseEndTime * 1000).toISOString()}`);
        
        const currentBettingTimestamp = Math.floor(Date.now() / 1000);
        const bettingTimeRemaining = bettingPhaseEndTime - currentBettingTimestamp;
        
        if (bettingTimeRemaining > 0) {
          log(`Waiting ${bettingTimeRemaining} seconds for betting phase to end...`);
          log("(If this is too long, consider modifying the contract's BETTING_PHASE_DURATION for testing)");
          
          // On ten, we actually have to wait
          if (network.name === "ten") {
            // Option to wait manually
            log("Press Ctrl+C to exit if you want to wait manually and resume the test later");
            log("Otherwise, the test will continue when the betting phase ends");
            
            // Wait until the betting phase ends
            while (Math.floor(Date.now() / 1000) < bettingPhaseEndTime) {
              await new Promise(resolve => setTimeout(resolve, 5000));
              const currentTime = Math.floor(Date.now() / 1000);
              const remaining = bettingPhaseEndTime - currentTime;
              if (remaining > 0 && remaining % 30 === 0) {
                log(`${remaining} seconds remaining in betting phase`);
              }
            }
          } else {
            // On local networks, we can advance time
            try {
              await ethers.provider.send("evm_increaseTime", [bettingTimeRemaining + 5]);
              await ethers.provider.send("evm_mine");
              log("Time advanced successfully");
            } catch (error) {
              log(`Error advancing time: ${error.message}`);
              log("Continuing test assuming time has passed.");
            }
          }
        }
      } else {
        log("WARNING: bettingPhaseEndTime is not available. Cannot determine when betting phase ends.");
        log("Waiting for 60 seconds as a fallback...");
        await new Promise(resolve => setTimeout(resolve, 60000));
      }

      let gameEndedListener = null;
let gameEndedPromise = new Promise((resolve) => {
  gameEndedListener = pokerContract.on("GameEnded", async (gameIdEvent, winner, potAmount) => {
    if (gameIdEvent.toString() === gameId.toString()) {
      log(`\n===== GAME ENDED EVENT CAPTURED =====`);
      log(`Winner: ${winner}`);
      log(`Pot Amount: ${potAmount.toString()} chips`);
      
      // Find which player number won
      const winnerIndex = players.findIndex(p => p.address.toLowerCase() === winner.toLowerCase());
      if (winnerIndex !== -1) {
        log(`Player ${winnerIndex + 1} (${players[winnerIndex].address}) won the game!`);
      }
      
      resolve({ winner, potAmount });
    }
  });
});
      
      log("\n----- ENDING BETTING PHASE -----");
      try {
        const endBettingTx = await pokerContract.connect(keeper).endBettingPhase(gameId, extremelyHighGasTxOptions);
        log("endBettingPhase transaction submitted, waiting for confirmation...");
        const endBettingReceipt = await endBettingTx.wait();
        log("endBettingPhase transaction confirmed!");
        
        // Log all events from the receipt for debugging
        log("\n----- TRANSACTION EVENTS -----");
        for (const event of endBettingReceipt.events) {
          if (event.event) {
            log(`Event: ${event.event}`);
            log(`Arguments: ${JSON.stringify(event.args)}`);
          } else {
            log(`Unknown event: ${JSON.stringify(event)}`);
          }
        }
        
        // Look for ShowdownStarted event
        const showdownEvent = endBettingReceipt.events.find(e => e.event === "ShowdownStarted");
        if (showdownEvent) {
          log("Showdown phase started");
        } else {
          log("WARNING: ShowdownStarted event not found in logs");
        }
        
        // Look for GameEnded event to get the winner
        const gameEndedEvent = endBettingReceipt.events.find(e => e.event === "GameEnded");
        if (gameEndedEvent) {
          const winner = gameEndedEvent.args.winner;
          const potAmount = gameEndedEvent.args.potAmount.toString();
          
          log(`\n===== GAME RESULTS =====`);
          log(`Winner: ${winner}`);
          log(`Pot Amount: ${potAmount} chips`);
          
          // Find which player number won
          const winnerIndex = players.findIndex(p => p.address.toLowerCase() === winner.toLowerCase());
          if (winnerIndex !== -1) {
            log(`Player ${winnerIndex + 1} won the game!`);
          }
        } else {
          log("WARNING: GameEnded event not found in transaction logs");
        }
        
        // Detailed debugging to figure out what happened
        log("\n----- DEBUGGING GAME STATE AFTER SHOWDOWN -----");
        try {
          // Get the game state
          const finalGameState = await pokerContract.getGameState(gameId);
          log(`Game state after showdown: ${GameState[finalGameState.state]}`);
          log(`Final pot amount: ${finalGameState.potAmount}`);
          
          // Try to get player state information
          log("\nFinal player states:");
          for (let i = 0; i < players.length; i++) {
            try {
              const playerState = await pokerContract.getPlayerState(gameId, players[i].address);
              log(`Player ${i + 1} (${players[i].address}):`);
              log(`  Is active: ${playerState[0]}`);
              log(`  Has peeked: ${playerState[1]}`);
              log(`  Has swapped: ${playerState[2]}`);
              log(`  Chip balance: ${playerState[3]}`);
              log(`  Current bet: ${playerState[4]}`);
              log(`  Has folded: ${playerState[5]}`);
              log(`  Last action time: ${playerState[6]}`);
            } catch (error) {
              log(`Error getting state for Player ${i + 1}: ${error.message}`);
            }
          }
          
          // Check all player balances
          log("\nFinal player chip balances:");
          for (let i = 0; i < players.length; i++) {
            try {
              const balance = await pokerContract.getChipBalance(gameId, players[i].address);
              log(`Player ${i + 1} (${players[i].address}): ${balance} chips (initial: ${initialChipBalances[players[i].address] || "unknown"})`);
              
              // Check if this player gained chips (potential winner)
              if (initialChipBalances[players[i].address] && balance > initialChipBalances[players[i].address]) {
                log(`*** Player ${i + 1} gained ${balance - initialChipBalances[players[i].address]} chips - likely the winner! ***`);
              }
            } catch (error) {
              log(`Error getting balance for Player ${i + 1}: ${error.message}`);
            }
          }
          
          // Try to get active players
          try {
            const activePlayers = await pokerContract.getActivePlayers(gameId);
            log(`\nActive players at end: ${activePlayers.length}`);
            for (let i = 0; i < activePlayers.length; i++) {
              log(`- Active player ${i+1}: ${activePlayers[i]}`);
            }
          } catch (error) {
            log(`Error getting active players: ${error.message}`);
          }
          
          // Try to get the player cards
          log("\nFinal player cards:");
          for (const playerAddr in playerCards) {
            log(`Player ${playerAddr}: ${playerCards[playerAddr].cardString}`);
          }
          
        } catch (error) {
          log(`Error debugging game state after showdown: ${error.message}`);
        }
        
        // Cleanup the game
        log("\n----- CLEANING UP THE GAME -----");
        try {
          const cleanupTx = await pokerContract.connect(keeper).cleanup(gameId, highGasTxOptions);
          await cleanupTx.wait();
          log("Game cleaned up successfully");
        } catch (error) {
          log(`Error cleaning up game: ${error.message}`);
        }
      } catch (error) {
        log(`Error ending betting phase: ${error.message}`);
        if (error.message.includes("gas")) {
          log("This appears to be a gas-related issue. Try increasing the gas limit further.");
        }
      }
    } catch (error) {
      log(`Error ending peek phase: ${error.message}`);
      if (error.message.includes("gas")) {
        log("This appears to be a gas-related issue. Try increasing the gas limit further.");
      }
    }
    
    log("\n===== HIDDEN ONE CARD POKER FULL GAME TEST COMPLETED =====");
    
    // Close the log file
    logStream.end();
  });
});
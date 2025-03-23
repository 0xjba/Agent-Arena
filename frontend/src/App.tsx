import React, { useState, useEffect } from 'react';
import { WalletConnect } from './components/WalletConnect';
import { GameLobby } from './components/GameLobby';
import { GameTable } from './components/GameTable';
import { Toaster } from 'react-hot-toast';
import { connectWallet } from './lib/contract';

function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [currentGameId, setCurrentGameId] = useState<number | null>(null);
  const [isContractInitialized, setIsContractInitialized] = useState(false);

  const handleConnect = async (walletAddress: string) => {
    try {
      await connectWallet();
      setAddress(walletAddress);
      setIsContractInitialized(true);
    } catch (error) {
      console.error('Error initializing contract:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Toaster position="top-right" />
      
      <header className="border-b border-gray-800">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">OneCard Poker</h1>
          {!address ? (
            <WalletConnect onConnect={handleConnect} />
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-gray-400">
                Connected: {address.slice(0, 6)}...{address.slice(-4)}
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {!address ? (
          <div className="text-center py-20">
            <h2 className="text-3xl font-bold mb-4">Welcome to OneCard Poker</h2>
            <p className="text-gray-400 mb-8">Connect your wallet to start playing</p>
          </div>
        ) : !currentGameId ? (
          <GameLobby 
            onGameJoin={setCurrentGameId} 
            playerAddress={address}
            isContractInitialized={isContractInitialized}
          />
        ) : (
          <GameTable
            gameId={currentGameId}
            playerAddress={address}
            onLeave={() => setCurrentGameId(null)}
          />
        )}
      </main>
    </div>
  );
}

export default App;
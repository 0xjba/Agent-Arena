import React from 'react';
import { Wallet } from 'lucide-react';
import { connectWallet } from '../lib/contract';
import toast from 'react-hot-toast';

interface WalletConnectProps {
  onConnect: (address: string) => void;
}

export function WalletConnect({ onConnect }: WalletConnectProps) {
  const handleConnect = async () => {
    try {
      const { address } = await connectWallet();
      onConnect(address);
      toast.success('Wallet connected successfully!');
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      toast.error('Failed to connect wallet. Please make sure MetaMask is installed and try again.');
    }
  };

  return (
    <button
      onClick={handleConnect}
      className="flex items-center gap-2 px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
    >
      <Wallet className="w-5 h-5" />
      Connect Wallet
    </button>
  );
}
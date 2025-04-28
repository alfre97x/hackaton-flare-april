/**
 * Flare FDC Service
 * Handles interaction with Flare Network's Data Consensus (FDC) system
 * through the DataPurchase smart contract
 */

// Cache for FDC attestation results to avoid unnecessary blockchain calls
const fdcCache = new Map();

// Default contract ABI for DataPurchase contract
const DEFAULT_CONTRACT_ABI = [
    // FDC related functions
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "requestId",
                "type": "bytes32"
            }
        ],
        "name": "purchase",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "requestId",
                "type": "bytes32"
            },
            {
                "internalType": "bytes32",
                "name": "attestationResponse",
                "type": "bytes32"
            },
            {
                "internalType": "bytes",
                "name": "proof",
                "type": "bytes"
            }
        ],
        "name": "deliverData",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    // Events
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "buyer",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "requestId",
                "type": "bytes32"
            }
        ],
        "name": "DataRequested",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "requestId",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "dataHash",
                "type": "bytes32"
            }
        ],
        "name": "DataDelivered",
        "type": "event"
    }
];

// Flare Network configuration
const FLARE_NETWORK_CONFIG = {
    chainId: '0x10', // Chain ID for Coston Testnet (16 in decimal)
    chainName: 'Coston Testnet',
    rpcUrls: ['https://coston-api.flare.network/ext/C/rpc'],
    blockExplorerUrls: ['https://coston-explorer.flare.network']
};

// Contract address from config
const DATA_PURCHASE_CONTRACT_ADDRESS = '0x2330d0cc23fd6764b7c67023c8fb85ae7287bfc9';

// Connection state
let provider = null;
let signer = null;
let contract = null;
let isInitialized = false;
let isConnecting = false;
let connectionError = null;

/**
 * Initialize connection to Flare Network and contract
 * @returns {Promise<boolean>} True if initialization successful
 */
async function initialize() {
    if (isInitialized) return true;
    if (isConnecting) return false;
    
    isConnecting = true;
    connectionError = null;
    
    try {
        console.log('Initializing Flare VRF service...');
        
        // Check if MetaMask is available
        if (typeof window.ethereum === 'undefined') {
            throw new Error('MetaMask is not installed');
        }
        
        // Request account access if needed
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        
        // Create provider and signer
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        
        // Check if we're on the correct network
        const network = await provider.getNetwork();
        if (network.chainId !== BigInt(parseInt(FLARE_NETWORK_CONFIG.chainId, 16))) {
            console.log('Switching to Flare Coston Testnet...');
            try {
                // Try to switch to Flare network
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: FLARE_NETWORK_CONFIG.chainId }]
                });
            } catch (switchError) {
                // If the network doesn't exist in MetaMask, add it
                if (switchError.code === 4902) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [FLARE_NETWORK_CONFIG]
                    });
                } else {
                    throw switchError;
                }
            }
        }
        
        // Create contract instance
        contract = new ethers.Contract(
            DATA_PURCHASE_CONTRACT_ADDRESS,
            DEFAULT_CONTRACT_ABI,
            signer
        );
        
        console.log('Flare VRF service initialized successfully');
        isInitialized = true;
        isConnecting = false;
        return true;
    } catch (error) {
        console.error('Failed to initialize Flare VRF service:', error);
        connectionError = error.message;
        isConnecting = false;
        return false;
    }
}

/**
 * Generate a request ID from parameters
 * @param {Object} params - Parameters to generate request ID from
 * @returns {string} - Request ID as hex string
 */
function generateRequestId(params) {
    // Convert params to string and hash it
    const paramsString = JSON.stringify(params);
    
    // Create a hash using a simple algorithm
    let hash = 0;
    for (let i = 0; i < paramsString.length; i++) {
        const char = paramsString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    
    // Convert to hex string with 0x prefix
    const hexString = '0x' + Math.abs(hash).toString(16).padStart(64, '0');
    return hexString;
}

/**
 * Purchase data and request attestation from Flare FDC
 * @param {Object} params - Parameters to include in the request
 * @returns {Promise<Object>} - Object with transaction hash and request ID
 */
async function purchaseData(params) {
    // Generate a deterministic request ID from params
    const requestId = generateRequestId(params);
    
    // Check cache first
    if (fdcCache.has(requestId)) {
        console.log('Using cached FDC result for request:', requestId);
        return fdcCache.get(requestId);
    }
    
    // Initialize if needed
    if (!isInitialized) {
        const success = await initialize();
        if (!success) {
            console.warn('Using fallback data generation due to initialization failure:', connectionError);
            return useFallbackData(params);
        }
    }
    
    try {
        console.log('Purchasing data and requesting attestation from Flare FDC for request:', requestId);
        
        // Calculate price in wei (0.01 FLR)
        const price = ethers.parseEther('0.01');
        
        // Call the purchase function on the contract
        const tx = await contract.purchase(requestId, { value: price });
        
        // Wait for the transaction to be mined
        const receipt = await tx.wait();
        
        // Get the transaction hash
        const txHash = receipt.hash;
        
        const result = {
            requestId,
            txHash,
            status: 'pending'
        };
        
        // Cache the result
        fdcCache.set(requestId, result);
        
        console.log('Data purchase transaction submitted:', result);
        return result;
    } catch (error) {
        console.error('Error purchasing data from Flare FDC:', error);
        return useFallbackData(params);
    }
}

/**
 * Fallback data generation when blockchain is unavailable
 * @param {Object} params - Parameters to include in the request
 * @returns {Promise<Object>} - Object with transaction hash and request ID
 */
function useFallbackData(params) {
    console.log('Using fallback data generation');
    
    // Generate a deterministic request ID from params
    const requestId = generateRequestId(params);
    
    // Generate a fake transaction hash
    const txHash = '0x' + Array.from({length: 64}, () => 
        Math.floor(Math.random() * 16).toString(16)).join('');
    
    const result = {
        requestId,
        txHash,
        status: 'completed',
        isFallback: true
    };
    
    // Cache the result
    fdcCache.set(requestId, result);
    
    return result;
}

/**
 * Clear the FDC cache
 */
function clearCache() {
    fdcCache.clear();
}

/**
 * Get connection status
 * @returns {Object} - Connection status object
 */
function getConnectionStatus() {
    return {
        isInitialized,
        isConnecting,
        connectionError
    };
}

// Export functions for use in other files
window.flareFDC = {
    initialize,
    purchaseData,
    clearCache,
    getConnectionStatus
};

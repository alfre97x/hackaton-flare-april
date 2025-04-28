// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title DataPurchaseRandomizer
 * @dev A contract to request VRF random numbers for price randomization.
 */

interface IVRFCoordinator {
    function requestRandomWords(
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint32 numWords
    ) external returns (uint256 requestId);
}

contract DataPurchaseRandomizer {
    // Events
    event RandomnessRequested(bytes32 indexed userProvidedId, uint256 indexed requestId);
    event RandomnessDelivered(bytes32 indexed userProvidedId, uint256 indexed requestId, uint256 randomValue);

    // State variables
    address public owner;
    address public vrfCoordinator;
    bytes32 public keyHash;
    uint32 public callbackGasLimit = 200000;
    uint16 public requestConfirmations = 3;
    uint32 public numWords = 1;

    // Mappings
    mapping(uint256 => bytes32) public requestIdToUserProvidedId;
    mapping(bytes32 => uint256) public userProvidedIdToRandomValue;
    mapping(bytes32 => bool) public userProvidedIdFulfilled;

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyVRFCoordinator() {
        require(msg.sender == vrfCoordinator, "Only VRFCoordinator");
        _;
    }

    /**
     * @dev Constructor
     * @param _vrfCoordinator Address of the VRF Coordinator
     * @param _keyHash Key hash for VRF
     */
    constructor(address _vrfCoordinator, bytes32 _keyHash) {
        owner = msg.sender;
        vrfCoordinator = _vrfCoordinator;
        keyHash = _keyHash;
    }

    /**
     * @notice Request randomness from Flare VRF Coordinator
     * @param _userProvidedId Custom ID for tracking
     * @return requestId The ID of the VRF request
     */
    function requestRandomness(bytes32 _userProvidedId) external returns (uint256) {
        require(!userProvidedIdFulfilled[_userProvidedId], "Request already fulfilled");
        
        uint256 requestId = IVRFCoordinator(vrfCoordinator).requestRandomWords(
            keyHash,
            callbackGasLimit,
            requestConfirmations,
            numWords
        );

        requestIdToUserProvidedId[requestId] = _userProvidedId;
        
        emit RandomnessRequested(_userProvidedId, requestId);
        
        return requestId;
    }

    /**
     * @notice Callback function called by VRF Coordinator after randomness is ready
     * @param requestId The ID of the VRF request
     * @param randomWords The random values generated
     */
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external onlyVRFCoordinator {
        bytes32 userProvidedId = requestIdToUserProvidedId[requestId];
        require(userProvidedId != bytes32(0), "Request not found");
        require(!userProvidedIdFulfilled[userProvidedId], "Request already fulfilled");
        
        uint256 randomValue = randomWords[0];
        userProvidedIdToRandomValue[userProvidedId] = randomValue;
        userProvidedIdFulfilled[userProvidedId] = true;
        
        emit RandomnessDelivered(userProvidedId, requestId, randomValue);
    }

    /**
     * @notice Get the random value for a user provided ID
     * @param _userProvidedId The user provided ID
     * @return randomValue The random value
     * @return fulfilled Whether the request has been fulfilled
     */
    function getRandomValue(bytes32 _userProvidedId) external view returns (uint256 randomValue, bool fulfilled) {
        return (userProvidedIdToRandomValue[_userProvidedId], userProvidedIdFulfilled[_userProvidedId]);
    }

    /**
     * @notice Get a normalized random value between 0 and 1
     * @param _userProvidedId The user provided ID
     * @return normalizedValue The normalized random value (0-1)
     * @return fulfilled Whether the request has been fulfilled
     */
    function getNormalizedRandomValue(bytes32 _userProvidedId) external view returns (uint256 normalizedValue, bool fulfilled) {
        if (!userProvidedIdFulfilled[_userProvidedId]) {
            return (0, false);
        }
        
        uint256 randomValue = userProvidedIdToRandomValue[_userProvidedId];
        // Normalize to 0-1000 range (representing 0-1 with 3 decimal places)
        normalizedValue = (randomValue % 1000);
        
        return (normalizedValue, true);
    }

    /**
     * @notice Get a random price variation factor
     * @param _userProvidedId The user provided ID
     * @param _basePrice The base price to apply variation to
     * @param _variationPercent The maximum variation percentage (e.g., 10 for ±10%)
     * @return finalPrice The price with random variation applied
     * @return variationFactor The variation factor applied (e.g., -5 for -5%)
     * @return fulfilled Whether the request has been fulfilled
     */
    function getRandomPriceVariation(
        bytes32 _userProvidedId, 
        uint256 _basePrice, 
        uint256 _variationPercent
    ) external view returns (uint256 finalPrice, int256 variationFactor, bool fulfilled) {
        if (!userProvidedIdFulfilled[_userProvidedId]) {
            return (_basePrice, 0, false);
        }
        
        uint256 randomValue = userProvidedIdToRandomValue[_userProvidedId];
        
        // Calculate variation factor between -_variationPercent and +_variationPercent
        // For example, if _variationPercent is 10, variationFactor will be between -10 and +10
        variationFactor = int256(randomValue % (2 * _variationPercent + 1)) - int256(_variationPercent);
        
        // Apply variation to base price
        if (variationFactor >= 0) {
            finalPrice = _basePrice + (_basePrice * uint256(variationFactor) / 100);
        } else {
            finalPrice = _basePrice - (_basePrice * uint256(-variationFactor) / 100);
        }
        
        return (finalPrice, variationFactor, true);
    }

    /**
     * @notice Allows owner to update VRF Coordinator address
     * @param _vrfCoordinator New VRF Coordinator address
     */
    function updateVRFCoordinator(address _vrfCoordinator) external onlyOwner {
        vrfCoordinator = _vrfCoordinator;
    }

    /**
     * @notice Allows owner to update VRF config
     * @param _keyHash New key hash
     * @param _callbackGasLimit New callback gas limit
     * @param _requestConfirmations New request confirmations
     */
    function updateVRFConfig(
        bytes32 _keyHash, 
        uint32 _callbackGasLimit, 
        uint16 _requestConfirmations
    ) external onlyOwner {
        keyHash = _keyHash;
        callbackGasLimit = _callbackGasLimit;
        requestConfirmations = _requestConfirmations;
    }

    /**
     * @notice Allows owner to withdraw ETH from the contract
     */
    function withdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    /**
     * @notice Fallback function to receive ETH
     */
    receive() external payable {}
}

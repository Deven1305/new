// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITextSetter} from "./interfaces/ITextSetter.sol";

/// @title PramaanTimelock
/// @notice Holds the ENSv2 resolver role for exactly one text key, `pramaan.record`, and delays every change to it.
///
///         - The proposer (the release CI) can only queue a new release pointer.
///         - Anyone can execute a queued pointer once its delay has passed.
///         - The guardian (the name owner; a Safe in production) can cancel queued pointers and rotate the proposer.
///
///         The contract makes no call other than `resolver.setText(name, "pramaan.record", value)`. A stolen CI key can
///         therefore only queue a visible, cancellable pointer change; it cannot touch any other record of the name.
contract PramaanTimelock {
    /// @notice The only ENS text key this contract ever writes.
    string public constant KEY = "pramaan.record";
    /// @notice Every pointer must start with this prefix (`pramaan:v1:<tag>:<sha256>`).
    bytes private constant POINTER_PREFIX = "pramaan:v1:";
    uint256 public constant MAX_VALUE_LENGTH = 256;
    uint256 public constant MIN_DELAY = 60;
    uint256 public constant MAX_DELAY = 30 days;
    /// @notice A queued pointer that is not executed within this window after its ETA can no longer be executed.
    uint256 public constant GRACE_PERIOD = 14 days;

    enum State {
        None,
        Queued,
        Executed,
        Cancelled
    }

    struct Operation {
        string value;
        uint64 eta;
        State state;
    }

    ITextSetter public immutable resolver;
    uint256 public immutable delay;
    address public immutable guardian;

    bytes private _dnsName;
    address public proposer;
    uint256 public operationCount;
    uint256 public lastExecutedId;
    mapping(uint256 id => Operation) private _operations;
    /// @notice The operation id that activated a pointer value (keccak256 of the value), or 0 if never activated.
    ///         A pointer value can be activated at most once, so an older release can never be re-activated by
    ///         queueing its old pointer again under a new id.
    mapping(bytes32 valueHash => uint256 id) public executedIdOf;

    event Queued(uint256 indexed id, string value, uint64 eta, address indexed proposer);
    event Executed(uint256 indexed id, string value, address indexed executor);
    event Cancelled(uint256 indexed id, address indexed guardian);
    event ProposerChanged(address indexed previousProposer, address indexed newProposer);

    error InvalidConfig();
    error NotProposer(address caller);
    error NotGuardian(address caller);
    error InvalidValue();
    error NotQueued(uint256 id);
    error NotReady(uint256 id, uint64 eta);
    error Expired(uint256 id);
    error Superseded(uint256 id, uint256 lastExecutedId);
    error AlreadyExecuted(uint256 id, uint256 executedId);

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian(msg.sender);
        _;
    }

    /// @param resolver_ The name's dedicated ENSv2 PermissionedResolver (proxy).
    /// @param dnsName_ The DNS-encoded ENS name, e.g. `\x0cpramaan-demo\x03eth\x00`.
    /// @param delay_ Seconds between queue and earliest execution.
    /// @param proposer_ The CI account allowed to queue.
    /// @param guardian_ The account allowed to cancel and rotate the proposer.
    constructor(ITextSetter resolver_, bytes memory dnsName_, uint256 delay_, address proposer_, address guardian_) {
        if (
            address(resolver_) == address(0) || dnsName_.length < 3 || dnsName_[dnsName_.length - 1] != 0x00
                || proposer_ == address(0) || guardian_ == address(0) || delay_ < MIN_DELAY || delay_ > MAX_DELAY
        ) revert InvalidConfig();
        resolver = resolver_;
        _dnsName = dnsName_;
        delay = delay_;
        proposer = proposer_;
        guardian = guardian_;
        emit ProposerChanged(address(0), proposer_);
    }

    /// @notice The DNS-encoded ENS name whose `pramaan.record` this timelock writes.
    function dnsName() external view returns (bytes memory) {
        return _dnsName;
    }

    /// @notice Queue a new release pointer. Only the proposer may call.
    function queue(string calldata value) external returns (uint256 id) {
        if (msg.sender != proposer) revert NotProposer(msg.sender);
        _validate(value);
        uint256 previous = executedIdOf[keccak256(bytes(value))];
        if (previous != 0) revert AlreadyExecuted(operationCount + 1, previous);
        id = ++operationCount;
        uint64 eta = uint64(block.timestamp + delay);
        _operations[id] = Operation({value: value, eta: eta, state: State.Queued});
        emit Queued(id, value, eta, msg.sender);
    }

    /// @notice Write a queued pointer into ENS. Anyone may call once the delay has passed.
    /// @dev Executing id N makes every still-queued id below N permanently unexecutable, and a pointer value that was
    ///      ever executed can never be queued or executed again: an older release cannot be replayed over a newer one.
    function execute(uint256 id) external {
        Operation storage op = _operations[id];
        if (op.state != State.Queued) revert NotQueued(id);
        if (block.timestamp < op.eta) revert NotReady(id, op.eta);
        if (block.timestamp > uint256(op.eta) + GRACE_PERIOD) revert Expired(id);
        if (id <= lastExecutedId) revert Superseded(id, lastExecutedId);
        bytes32 valueHash = keccak256(bytes(op.value));
        uint256 previous = executedIdOf[valueHash];
        if (previous != 0) revert AlreadyExecuted(id, previous);
        op.state = State.Executed;
        lastExecutedId = id;
        executedIdOf[valueHash] = id;
        resolver.setText(_dnsName, KEY, op.value);
        emit Executed(id, op.value, msg.sender);
    }

    /// @notice Cancel a queued pointer. Only the guardian may call.
    function cancel(uint256 id) external onlyGuardian {
        Operation storage op = _operations[id];
        if (op.state != State.Queued) revert NotQueued(id);
        op.state = State.Cancelled;
        emit Cancelled(id, msg.sender);
    }

    /// @notice Replace the proposer (for example after a CI key leak). Only the guardian may call.
    function setProposer(address newProposer) external onlyGuardian {
        if (newProposer == address(0)) revert InvalidConfig();
        emit ProposerChanged(proposer, newProposer);
        proposer = newProposer;
    }

    function getOperation(uint256 id) external view returns (string memory value, uint64 eta, State state) {
        Operation storage op = _operations[id];
        return (op.value, op.eta, op.state);
    }

    /// @notice True when `id` is queued and executable right now.
    function isReady(uint256 id) external view returns (bool) {
        Operation storage op = _operations[id];
        return op.state == State.Queued && block.timestamp >= op.eta && block.timestamp <= uint256(op.eta) + GRACE_PERIOD
            && id > lastExecutedId;
    }

    function _validate(string calldata value) private pure {
        bytes calldata b = bytes(value);
        uint256 prefixLength = POINTER_PREFIX.length;
        if (b.length <= prefixLength || b.length > MAX_VALUE_LENGTH) revert InvalidValue();
        for (uint256 i; i < prefixLength; ++i) {
            if (b[i] != POINTER_PREFIX[i]) revert InvalidValue();
        }
        // Printable ASCII only: no spaces, control characters or Unicode look-alikes.
        for (uint256 i = prefixLength; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c < 0x21 || c > 0x7e) revert InvalidValue();
        }
    }
}

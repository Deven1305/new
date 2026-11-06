import { parseAbi } from "viem";

/** ENSv2 functions Pramaan calls, copied from the Sourcify-verified Sepolia ABIs (see config/ensv2.sepolia.json). */
export const ethRegistrarAbi = parseAbi([
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function MAX_COMMITMENT_AGE() view returns (uint64)",
  "function MIN_REGISTER_DURATION() view returns (uint64)",
  "function rentPriceOracle() view returns (address)",
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256, uint256)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function commitmentAt(bytes32 commitment) view returns (uint64)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
  "event NameRegistered(uint256 indexed tokenId, string label, address owner, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 indexed referrer, uint256 base, uint256 premium)",
]);

export const rentPriceOracleAbi = parseAbi(["function isPaymentToken(address paymentToken) view returns (bool)"]);

export const ethRegistryAbi = parseAbi([
  "function findTokenId(string label) view returns (uint256)",
  "function findOwner(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function setResolver(uint256 anyId, address resolver)",
  "function setSubregistry(uint256 anyId, address registry)",
  "function getSubregistry(string label) view returns (address)",
  "function getParent() view returns (address parent, string label)",
  "function hasRoles(uint256 anyId, uint256 roleBitmap, address account) view returns (bool)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "event ResolverUpdated(uint256 indexed tokenId, address indexed resolver, address indexed sender)",
  "event SubregistryUpdated(uint256 indexed tokenId, address indexed subregistry, address indexed sender)",
  "error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)",
]);

/**
 * ENSv2 UserRegistry (a UUPS PermissionedRegistry deployed per name through the VerifiableFactory), Sourcify-verified
 * implementation 0x9bd8a88719068d09ecee662f36c0e3856708366a on Sepolia ("UserRegistryImpl" in docs.ens.domains/learn/deployments).
 */
export const userRegistryAbi = parseAbi([
  "struct Grant { address account; uint256 roleBitmap; }",
  "function initialize(Grant[] grants)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function setParent(address parent, string label)",
  "function getParent() view returns (address parent, string label)",
  "function getResolver(string label) view returns (address)",
  "function getSubregistry(string label) view returns (address)",
  "function setResolver(uint256 anyId, address resolver)",
  "function setSubregistry(uint256 anyId, address registry)",
  "function findTokenId(string label) view returns (uint256)",
  "function findOwner(string label) view returns (address)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
  "function hasRoles(uint256 anyId, uint256 roleBitmap, address account) view returns (bool)",
  "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)",
  "error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)",
  "error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account)",
  "error LabelAlreadyRegistered(string label)",
]);

export const verifiableFactoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "function predictProxyAddress(address deployer, uint256 salt) view returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);

export const permissionedResolverAbi = parseAbi([
  "struct Grant { address account; uint256 roleBitmap; }",
  "function initialize(Grant[] grants, bytes[] calls)",
  "function setText(bytes name, string key, string value)",
  "function setAddress(bytes name, uint256 coinType, bytes addressBytes)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
  "function revokeRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "function text(bytes32 node, string key) view returns (string)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "function linkToRecord(bytes sourceName, uint256 recordId)",
  "event TextUpdated(uint256 indexed recordId, string indexed keyHash, string key, string value)",
  "event Linked(uint256 indexed recordId, bytes32 indexed node, bytes name)",
  "event Upgraded(address indexed implementation)",
  "event EACRolesChanged(uint256 indexed resource, address indexed account, uint256 oldRoleBitmap, uint256 newRoleBitmap)",
  "error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)",
  "error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account)",
  "error EACCannotRevokeRoles(uint256 resource, uint256 roleBitmap, address account)",
]);

export const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const timelockAbi = parseAbi([
  "function KEY() view returns (string)",
  "function delay() view returns (uint256)",
  "function proposer() view returns (address)",
  "function guardian() view returns (address)",
  "function resolver() view returns (address)",
  "function dnsName() view returns (bytes)",
  "function operationCount() view returns (uint256)",
  "function lastExecutedId() view returns (uint256)",
  "function getOperation(uint256 id) view returns (string value, uint64 eta, uint8 state)",
  "function isReady(uint256 id) view returns (bool)",
  "function GRACE_PERIOD() view returns (uint256)",
  "function executedIdOf(bytes32 valueHash) view returns (uint256)",
  "function queue(string value) returns (uint256 id)",
  "function execute(uint256 id)",
  "function cancel(uint256 id)",
  "function setProposer(address newProposer)",
  "event Queued(uint256 indexed id, string value, uint64 eta, address indexed proposer)",
  "event Executed(uint256 indexed id, string value, address indexed executor)",
  "event Cancelled(uint256 indexed id, address indexed guardian)",
  "event ProposerChanged(address indexed previousProposer, address indexed newProposer)",
  "error NotProposer(address caller)",
  "error NotGuardian(address caller)",
  "error InvalidValue()",
  "error NotQueued(uint256 id)",
  "error NotReady(uint256 id, uint64 eta)",
  "error Expired(uint256 id)",
  "error Superseded(uint256 id, uint256 lastExecutedId)",
  "error AlreadyExecuted(uint256 id, uint256 executedId)",
]);

export const erc1967Abi = parseAbi(["event Upgraded(address indexed implementation)"]);

/** PermissionedResolverLib / EACBaseRolesLib constants (verified source). */
export const ROLES = {
  ROLE_SET_ADDRESS: 1n << 0n,
  ROLE_SET_TEXT: 1n << 4n,
  ROLE_LINK: 1n << 28n,
  ROLE_UPGRADE: 1n << 124n,
  ALL_ROLES: 0x1111111111111111111111111111111111111111111111111111111111111111n,
} as const;

/** RegistryRolesLib (verified source). Admin roles are the same bit shifted left by 128. */
export const REGISTRY_ROLES = {
  ROLE_REGISTRAR: 1n << 0n,
  ROLE_REGISTER_RESERVED: 1n << 4n,
  ROLE_SET_PARENT: 1n << 8n,
  ROLE_UNREGISTER: 1n << 12n,
  ROLE_RENEW: 1n << 16n,
  ROLE_SET_SUBREGISTRY: 1n << 20n,
  ROLE_SET_RESOLVER: 1n << 24n,
  ROLE_CAN_TRANSFER_ADMIN: (1n << 28n) << 128n,
  ROLE_UPGRADE: 1n << 124n,
} as const;
export const adminOf = (role: bigint): bigint => role << 128n;

export const TIMELOCK_STATE = ["None", "Queued", "Executed", "Cancelled"] as const;

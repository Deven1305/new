// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20Errors, IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PermitMarketplace} from "../src/demo/PermitMarketplace.sol";
import {DemoToken} from "../src/demo/DemoToken.sol";
import {DemoNFT} from "../src/demo/DemoNFT.sol";

/// @dev Buyer contract that tries to re-enter the marketplace while it receives the NFT.
contract ReentrantBuyer is IERC721Receiver {
    PermitMarketplace public immutable market;
    uint256 public targetListing;
    bytes4 public lastReentryError;
    bool public attempted;

    constructor(PermitMarketplace market_) {
        market = market_;
    }

    function approveAndBuy(IERC20 token, uint256 listingId, uint256 otherListingId, uint256 price) external {
        token.approve(address(market), price * 2);
        targetListing = otherListingId;
        market.buy(listingId);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        attempted = true;
        (bool ok, bytes memory ret) = address(market).call(abi.encodeCall(PermitMarketplace.buy, (targetListing)));
        require(!ok, "reentrant buy unexpectedly succeeded");
        lastReentryError = bytes4(ret);
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// @dev Payment token that calls back into the marketplace in the middle of a transfer.
contract ReentrantPayToken is ERC20 {
    PermitMarketplace public market;
    bytes public attack;
    bytes4 public lastReentryError;
    bool public attempted;

    constructor() ERC20("Evil", "EVIL") {
        _mint(msg.sender, 1_000_000e18);
    }

    function arm(PermitMarketplace market_, bytes calldata attack_) external {
        market = market_;
        attack = attack_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attack.length > 0 && address(market) != address(0) && from != address(0)) {
            bytes memory data = attack;
            attack = "";
            attempted = true;
            (bool ok, bytes memory ret) = address(market).call(data);
            require(!ok, "reentrant call unexpectedly succeeded");
            lastReentryError = bytes4(ret);
        }
    }
}

contract PermitMarketplaceTest is Test {
    bytes32 internal constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    uint256 internal constant PRICE = 25e6;

    DemoToken internal pusd;
    DemoNFT internal nft;
    PermitMarketplace internal market;

    address internal seller = makeAddr("seller");
    address internal other = makeAddr("other");
    address internal buyer;
    uint256 internal buyerKey;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 price);
    event ListingCancelled(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId);
    event Sold(uint256 indexed listingId, address indexed seller, address indexed buyer, uint256 tokenId, uint256 price);

    function setUp() public {
        pusd = new DemoToken();
        nft = new DemoNFT();
        market = new PermitMarketplace(IERC20(address(pusd)), IERC721(address(nft)));
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        pusd.transfer(buyer, 1_000e6);
        pusd.transfer(other, 1_000e6);
    }

    // -- helpers -----------------------------------------------------------------------------------------------------

    function _mint(address to) internal returns (uint256 id) {
        vm.prank(to);
        id = nft.mint();
    }

    function _listNew(address who, uint256 price) internal returns (uint256 tokenId, uint256 listingId) {
        tokenId = _mint(who);
        vm.startPrank(who);
        nft.setApprovalForAll(address(market), true);
        listingId = market.list(tokenId, price);
        vm.stopPrank();
    }

    function _permit(uint256 key, address owner_, address spender, uint256 value, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, pusd.nonces(owner_), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", pusd.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(key, digest);
    }

    // -- construction ------------------------------------------------------------------------------------------------

    function test_constructor_storesConfig() public view {
        assertEq(address(market.paymentToken()), address(pusd));
        assertEq(address(market.collection()), address(nft));
        assertEq(market.listingCount(), 0);
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(PermitMarketplace.ZeroAddress.selector);
        new PermitMarketplace(IERC20(address(0)), IERC721(address(nft)));
        vm.expectRevert(PermitMarketplace.ZeroAddress.selector);
        new PermitMarketplace(IERC20(address(pusd)), IERC721(address(0)));
    }

    // -- list --------------------------------------------------------------------------------------------------------

    function test_list_happyPath() public {
        uint256 tokenId = _mint(seller);
        vm.startPrank(seller);
        nft.setApprovalForAll(address(market), true);
        vm.expectEmit(true, true, true, true);
        emit Listed(1, seller, tokenId, PRICE);
        uint256 id = market.list(tokenId, PRICE);
        vm.stopPrank();
        assertEq(id, 1);
        (address s, bool active, uint256 t, uint256 p) = market.listings(1);
        assertEq(s, seller);
        assertTrue(active);
        assertEq(t, tokenId);
        assertEq(p, PRICE);
        assertEq(market.activeListingOf(tokenId), 1);
        assertEq(nft.ownerOf(tokenId), seller, "the NFT stays with the seller until it sells");
        assertTrue(market.isBuyable(1));
    }

    function test_list_withPerTokenApproval() public {
        uint256 tokenId = _mint(seller);
        vm.startPrank(seller);
        nft.approve(address(market), tokenId);
        market.list(tokenId, PRICE);
        vm.stopPrank();
        assertTrue(market.isBuyable(1));
    }

    function test_list_zeroPriceReverts() public {
        uint256 tokenId = _mint(seller);
        vm.prank(seller);
        vm.expectRevert(PermitMarketplace.ZeroPrice.selector);
        market.list(tokenId, 0);
    }

    function test_list_notTokenOwnerReverts() public {
        uint256 tokenId = _mint(seller);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.NotTokenOwner.selector, tokenId));
        market.list(tokenId, PRICE);
    }

    function test_list_nonexistentTokenReverts() public {
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 99));
        market.list(99, PRICE);
    }

    function test_list_marketplaceNotApprovedReverts() public {
        uint256 tokenId = _mint(seller);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.MarketplaceNotApproved.selector, tokenId));
        market.list(tokenId, PRICE);
    }

    function test_list_alreadyListedReverts() public {
        (uint256 tokenId, uint256 id) = _listNew(seller, PRICE);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.AlreadyListed.selector, tokenId, id));
        market.list(tokenId, PRICE * 2);
    }

    function test_list_afterCancelWorks() public {
        (uint256 tokenId, uint256 id) = _listNew(seller, PRICE);
        vm.startPrank(seller);
        market.cancel(id);
        uint256 id2 = market.list(tokenId, PRICE * 2);
        vm.stopPrank();
        assertEq(id2, 2);
        assertEq(market.activeListingOf(tokenId), 2);
    }

    function test_list_newOwnerVoidsPreviousOwnersListing() public {
        (uint256 tokenId, uint256 oldId) = _listNew(seller, PRICE);
        vm.prank(seller);
        nft.transferFrom(seller, other, tokenId); // sold outside the marketplace
        assertFalse(market.isBuyable(oldId));
        vm.startPrank(other);
        nft.setApprovalForAll(address(market), true);
        vm.expectEmit(true, true, true, true);
        emit ListingCancelled(oldId, seller, tokenId);
        uint256 newId = market.list(tokenId, PRICE * 3);
        vm.stopPrank();
        (, bool oldActive,,) = market.listings(oldId);
        assertFalse(oldActive);
        assertEq(market.activeListingOf(tokenId), newId);
    }

    // -- cancel ------------------------------------------------------------------------------------------------------

    function test_cancel_happyPath() public {
        (uint256 tokenId, uint256 id) = _listNew(seller, PRICE);
        vm.expectEmit(true, true, true, true);
        emit ListingCancelled(id, seller, tokenId);
        vm.prank(seller);
        market.cancel(id);
        (, bool active,,) = market.listings(id);
        assertFalse(active);
        assertEq(market.activeListingOf(tokenId), 0);
        assertFalse(market.isBuyable(id));
    }

    function test_cancel_unknownOrTwiceReverts() public {
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.ListingNotActive.selector, 7));
        market.cancel(7);
        (, uint256 id) = _listNew(seller, PRICE);
        vm.startPrank(seller);
        market.cancel(id);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.ListingNotActive.selector, id));
        market.cancel(id);
        vm.stopPrank();
    }

    function test_cancel_notSellerReverts() public {
        (, uint256 id) = _listNew(seller, PRICE);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.NotSeller.selector, id));
        market.cancel(id);
    }

    // -- buy ---------------------------------------------------------------------------------------------------------

    function test_buy_withExactApproval() public {
        (uint256 tokenId, uint256 id) = _listNew(seller, PRICE);
        vm.startPrank(buyer);
        pusd.approve(address(market), PRICE);
        vm.expectEmit(true, true, true, true);
        emit Sold(id, seller, buyer, tokenId, PRICE);
        market.buy(id);
        vm.stopPrank();
        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(pusd.balanceOf(seller), PRICE);
        assertEq(pusd.balanceOf(buyer), 1_000e6 - PRICE);
        assertEq(pusd.allowance(buyer, address(market)), 0, "exact approval fully consumed");
        (, bool active,,) = market.listings(id);
        assertFalse(active);
        assertEq(market.activeListingOf(tokenId), 0);
        assertEq(pusd.balanceOf(address(market)), 0, "the marketplace never holds funds");
    }

    function test_buy_withUnlimitedApprovalLeavesItStanding() public {
        (, uint256 id) = _listNew(seller, PRICE);
        vm.startPrank(buyer);
        pusd.approve(address(market), type(uint256).max);
        market.buy(id);
        vm.stopPrank();
        assertEq(pusd.allowance(buyer, address(market)), type(uint256).max, "OZ keeps max allowances: the risk the extension flags");
    }

    function test_buy_inactiveListingReverts() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.ListingNotActive.selector, 1));
        market.buy(1);
        (, uint256 id) = _listNew(seller, PRICE);
        vm.prank(seller);
        market.cancel(id);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.ListingNotActive.selector, id));
        market.buy(id);
    }

    function test_buy_cannotBuyTwice() public {
        (, uint256 id) = _listNew(seller, PRICE);
        vm.startPrank(buyer);
        pusd.approve(address(market), PRICE * 2);
        market.buy(id);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.ListingNotActive.selector, id));
        market.buy(id);
        vm.stopPrank();
    }

    function test_buy_sellerIsBuyerReverts() public {
        (, uint256 id) = _listNew(seller, PRICE);
        pusd.transfer(seller, PRICE);
        vm.startPrank(seller);
        pusd.approve(address(market), PRICE);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.SellerIsBuyer.selector, id));
        market.buy(id);
        vm.stopPrank();
    }

    function test_buy_staleListingReverts() public {
        (uint256 tokenId, uint256 id) = _listNew(seller, PRICE);
        vm.prank(seller);
        nft.transferFrom(seller, other, tokenId);
        vm.startPrank(buyer);
        pusd.approve(address(market), PRICE);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.StaleListing.selector, id));
        market.buy(id);
        vm.stopPrank();
        assertEq(pusd.balanceOf(buyer), 1_000e6, "nothing was charged");
    }

    function test_buy_withoutAllowanceReverts() public {
        (, uint256 id) = _listNew(seller, PRICE);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(market), 0, PRICE));
        market.buy(id);
    }

    function test_buy_insufficientBalanceReverts() public {
        (, uint256 id) = _listNew(seller, 5_000e6);
        vm.startPrank(buyer);
        pusd.approve(address(market), 5_000e6);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, buyer, 1_000e6, 5_000e6));
        market.buy(id);
        vm.stopPrank();
    }

    function test_buy_sellerRevokedApprovalReverts() public {
        (uint256 tokenId, uint256 id) = _listNew(seller, PRICE);
        vm.prank(seller);
        nft.setApprovalForAll(address(market), false);
        assertFalse(market.isBuyable(id));
        vm.startPrank(buyer);
        pusd.approve(address(market), PRICE);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, address(market), tokenId));
        market.buy(id);
        vm.stopPrank();
        assertEq(pusd.balanceOf(seller), 0, "the payment reverted together with the failed transfer");
    }

    // -- buyWithPermit -----------------------------------------------------------------------------------------------

    function test_buyWithPermit_happyPathLeavesNoAllowance() public {
        (uint256 tokenId, uint256 id) = _listNew(seller, PRICE);
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerKey, buyer, address(market), PRICE, deadline);
        assertEq(pusd.allowance(buyer, address(market)), 0, "no approve transaction");
        vm.prank(buyer);
        market.buyWithPermit(id, deadline, v, r, s);
        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(pusd.balanceOf(seller), PRICE);
        assertEq(pusd.allowance(buyer, address(market)), 0, "permit allowance consumed exactly");
        assertEq(pusd.nonces(buyer), 1);
    }

    function test_buyWithPermit_inactiveListingReverts() public {
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerKey, buyer, address(market), PRICE, deadline);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.ListingNotActive.selector, 1));
        market.buyWithPermit(1, deadline, v, r, s);
    }

    function test_buyWithPermit_expiredDeadlineReverts() public {
        (, uint256 id) = _listNew(seller, PRICE);
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerKey, buyer, address(market), PRICE, deadline);
        skip(21 minutes);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.PermitAllowanceTooLow.selector, 0, PRICE));
        market.buyWithPermit(id, deadline, v, r, s);
    }

    function test_buyWithPermit_wrongValueReverts() public {
        (, uint256 id) = _listNew(seller, PRICE);
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerKey, buyer, address(market), PRICE - 1, deadline);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.PermitAllowanceTooLow.selector, 0, PRICE));
        market.buyWithPermit(id, deadline, v, r, s);
    }

    function test_buyWithPermit_signedForSomeoneElseReverts() public {
        (, uint256 id) = _listNew(seller, PRICE);
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerKey, buyer, other, PRICE, deadline); // wrong spender
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.PermitAllowanceTooLow.selector, 0, PRICE));
        market.buyWithPermit(id, deadline, v, r, s);
    }

    function test_buyWithPermit_callerMustBeTheSigner() public {
        (, uint256 id) = _listNew(seller, PRICE);
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerKey, buyer, address(market), PRICE, deadline);
        vm.prank(other); // permit names `buyer` as owner; the marketplace uses msg.sender as owner
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.PermitAllowanceTooLow.selector, 0, PRICE));
        market.buyWithPermit(id, deadline, v, r, s);
    }

    function test_buyWithPermit_frontRunPermitStillWorks() public {
        (uint256 tokenId, uint256 id) = _listNew(seller, PRICE);
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerKey, buyer, address(market), PRICE, deadline);
        pusd.permit(buyer, address(market), PRICE, deadline, v, r, s); // anyone submits the signature first
        vm.prank(buyer);
        market.buyWithPermit(id, deadline, v, r, s);
        assertEq(nft.ownerOf(tokenId), buyer);
    }

    function test_buyWithPermit_replayedSignatureReverts() public {
        (, uint256 id) = _listNew(seller, PRICE);
        (, uint256 id2) = _listNew(seller, PRICE);
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerKey, buyer, address(market), PRICE, deadline);
        vm.startPrank(buyer);
        market.buyWithPermit(id, deadline, v, r, s);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.PermitAllowanceTooLow.selector, 0, PRICE));
        market.buyWithPermit(id2, deadline, v, r, s);
        vm.stopPrank();
    }

    function test_buyWithPermit_sellerIsBuyerReverts() public {
        // an account that is both the seller and the permit signer
        (address both, uint256 bothKey) = makeAddrAndKey("both");
        pusd.transfer(both, PRICE);
        (, uint256 ownId) = _listNew(both, PRICE);
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(bothKey, both, address(market), PRICE, deadline);
        vm.prank(both);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.SellerIsBuyer.selector, ownId));
        market.buyWithPermit(ownId, deadline, v, r, s);
    }

    // -- views -------------------------------------------------------------------------------------------------------

    function test_listingsPage_paginatesAndClamps() public {
        for (uint256 i = 0; i < 5; ++i) {
            _listNew(address(uint160(0x1000 + i)), (i + 1) * 1e6);
        }
        assertEq(market.listingCount(), 5);
        PermitMarketplace.Listing[] memory page = market.listingsPage(1, 3);
        assertEq(page.length, 3);
        assertEq(page[0].price, 1e6);
        assertEq(page[2].price, 3e6);
        page = market.listingsPage(4, 10);
        assertEq(page.length, 2, "clamped to the existing ids");
        assertEq(page[1].price, 5e6);
        page = market.listingsPage(0, 2);
        assertEq(page.length, 2, "firstId 0 is treated as 1");
        assertEq(page[0].price, 1e6);
        assertEq(market.listingsPage(6, 5).length, 0);
        assertEq(market.listingsPage(1, 0).length, 0);
        assertEq(market.listingsPage(1, 1_000_000).length, 5);
    }

    function test_listingsPage_includesInactive() public {
        (, uint256 a) = _listNew(seller, PRICE);
        _listNew(other, PRICE);
        vm.prank(seller);
        market.cancel(a);
        PermitMarketplace.Listing[] memory page = market.listingsPage(1, 10);
        assertEq(page.length, 2);
        assertFalse(page[0].active);
        assertTrue(page[1].active);
    }

    function test_isBuyable_tracksOwnershipAndApproval() public {
        assertFalse(market.isBuyable(1));
        (uint256 tokenId, uint256 id) = _listNew(seller, PRICE);
        assertTrue(market.isBuyable(id));
        vm.prank(seller);
        nft.setApprovalForAll(address(market), false);
        assertFalse(market.isBuyable(id));
        vm.prank(seller);
        nft.approve(address(market), tokenId);
        assertTrue(market.isBuyable(id));
        vm.prank(seller);
        nft.transferFrom(seller, other, tokenId);
        assertFalse(market.isBuyable(id));
    }

    // -- reentrancy --------------------------------------------------------------------------------------------------

    function test_reentrancy_buyerCannotReenterOnNftReceipt() public {
        (, uint256 id1) = _listNew(seller, PRICE);
        (, uint256 id2) = _listNew(other, PRICE);
        ReentrantBuyer rb = new ReentrantBuyer(market);
        pusd.transfer(address(rb), PRICE * 2);
        rb.approveAndBuy(IERC20(address(pusd)), id1, id2, PRICE);
        assertTrue(rb.attempted());
        assertEq(rb.lastReentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(nft.balanceOf(address(rb)), 1, "only the outer purchase completed");
        (, bool active2,,) = market.listings(id2);
        assertTrue(active2);
    }

    function test_reentrancy_paymentTokenCannotReenterBuyOrCancel() public {
        ReentrantPayToken evil = new ReentrantPayToken();
        PermitMarketplace m = new PermitMarketplace(IERC20(address(evil)), IERC721(address(nft)));
        uint256 t1 = _mint(seller);
        uint256 t2 = _mint(seller);
        vm.startPrank(seller);
        nft.setApprovalForAll(address(m), true);
        m.list(t1, 10e18);
        m.list(t2, 10e18);
        vm.stopPrank();
        evil.transfer(buyer, 100e18);
        vm.prank(buyer);
        evil.approve(address(m), type(uint256).max);
        evil.arm(m, abi.encodeCall(PermitMarketplace.buy, (2)));
        vm.prank(buyer);
        m.buy(1);
        assertTrue(evil.attempted());
        assertEq(evil.lastReentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(nft.ownerOf(t1), buyer);
        assertEq(nft.ownerOf(t2), seller);
        (, bool active2,,) = m.listings(2);
        assertTrue(active2);
    }

    // -- fuzz --------------------------------------------------------------------------------------------------------

    function testFuzz_buyWithPermitConservesFunds(uint256 price) public {
        price = bound(price, 1, 1_000e6);
        (uint256 tokenId, uint256 id) = _listNew(seller, price);
        uint256 deadline = block.timestamp + 20 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerKey, buyer, address(market), price, deadline);
        uint256 total = pusd.balanceOf(buyer) + pusd.balanceOf(seller);
        vm.prank(buyer);
        market.buyWithPermit(id, deadline, v, r, s);
        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(pusd.balanceOf(seller), price);
        assertEq(pusd.balanceOf(buyer) + pusd.balanceOf(seller), total);
        assertEq(pusd.allowance(buyer, address(market)), 0);
        assertEq(pusd.balanceOf(address(market)), 0);
    }

    function testFuzz_listingsPageNeverOverreads(uint256 firstId, uint256 count, uint8 listed) public {
        listed = uint8(bound(listed, 0, 7));
        for (uint256 i = 0; i < listed; ++i) {
            _listNew(address(uint160(0x2000 + i)), 1e6 + i);
        }
        firstId = bound(firstId, 0, 12);
        count = bound(count, 0, 300);
        PermitMarketplace.Listing[] memory page = market.listingsPage(firstId, count);
        uint256 start = firstId == 0 ? 1 : firstId;
        uint256 cap = count > market.MAX_PAGE() ? market.MAX_PAGE() : count;
        assertLe(page.length, cap);
        assertLe(page.length, listed);
        for (uint256 i = 0; i < page.length; ++i) {
            assertEq(page[i].price, 1e6 + (start - 1 + i));
        }
    }

    function testFuzz_onlySellerCanCancel(address caller) public {
        vm.assume(caller != seller);
        (, uint256 id) = _listNew(seller, PRICE);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(PermitMarketplace.NotSeller.selector, id));
        market.cancel(id);
    }
}

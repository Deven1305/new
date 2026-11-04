// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PermitMarketplace
/// @notice Escrow-less fixed-price marketplace for one ERC-721 collection, paid in one ERC-20 (PermitMarket demo, test
///         networks only; the tokens have no value). Sellers keep their NFT until it sells and only approve the
///         marketplace; buyers pay the seller directly, either from an ERC-20 allowance or with an EIP-2612 permit
///         signed for exactly the listed price.
/// @dev Not upgradeable, no owner, no fees, holds no funds. Every state-changing function is nonReentrant, follows
///      checks-effects-interactions and emits an event.
contract PermitMarketplace is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Listing {
        address seller;
        bool active;
        uint256 tokenId;
        uint256 price;
    }

    uint256 public constant MAX_PAGE = 100;

    IERC20 public immutable paymentToken;
    IERC721 public immutable collection;

    /// @notice Number of listings ever created; listing ids run from 1 to listingCount.
    uint256 public listingCount;
    mapping(uint256 listingId => Listing) public listings;
    /// @notice The active listing of a token (0 = not listed).
    mapping(uint256 tokenId => uint256 listingId) public activeListingOf;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 price);
    event ListingCancelled(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId);
    event Sold(uint256 indexed listingId, address indexed seller, address indexed buyer, uint256 tokenId, uint256 price);

    error ZeroAddress();
    error ZeroPrice();
    error NotTokenOwner(uint256 tokenId);
    error MarketplaceNotApproved(uint256 tokenId);
    error AlreadyListed(uint256 tokenId, uint256 listingId);
    error ListingNotActive(uint256 listingId);
    error NotSeller(uint256 listingId);
    error SellerIsBuyer(uint256 listingId);
    error StaleListing(uint256 listingId);
    error PermitAllowanceTooLow(uint256 allowance, uint256 price);

    constructor(IERC20 paymentToken_, IERC721 collection_) {
        if (address(paymentToken_) == address(0) || address(collection_) == address(0)) revert ZeroAddress();
        paymentToken = paymentToken_;
        collection = collection_;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Sellers
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Lists `tokenId` for `price`. The caller must own it and have approved the marketplace (for this token or
    ///         with setApprovalForAll). The NFT stays in the seller's wallet.
    function list(uint256 tokenId, uint256 price) external nonReentrant returns (uint256 listingId) {
        if (price == 0) revert ZeroPrice();
        if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId);
        if (!_isApproved(msg.sender, tokenId)) revert MarketplaceNotApproved(tokenId);
        uint256 previous = activeListingOf[tokenId];
        if (previous != 0) {
            Listing storage old = listings[previous];
            if (old.seller == msg.sender) revert AlreadyListed(tokenId, previous);
            // The token changed hands outside the marketplace, so the previous owner's listing is void.
            old.active = false;
            emit ListingCancelled(previous, old.seller, tokenId);
        }
        listingId = ++listingCount;
        listings[listingId] = Listing({seller: msg.sender, active: true, tokenId: tokenId, price: price});
        activeListingOf[tokenId] = listingId;
        emit Listed(listingId, msg.sender, tokenId, price);
    }

    function cancel(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive(listingId);
        if (l.seller != msg.sender) revert NotSeller(listingId);
        uint256 tokenId = l.tokenId;
        l.active = false;
        delete activeListingOf[tokenId];
        emit ListingCancelled(listingId, msg.sender, tokenId);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Buyers
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Buys a listing, paying `price` from the caller's existing allowance to this marketplace.
    function buy(uint256 listingId) external nonReentrant {
        _buy(listingId);
    }

    /// @notice Buys a listing with an EIP-2612 permit for exactly the listed price (owner = caller, spender = this
    ///         marketplace), so no standing allowance is left behind.
    /// @dev If the same permit was already submitted by someone else (front-running), the allowance it set is used.
    function buyWithPermit(uint256 listingId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive(listingId);
        uint256 price = l.price;
        try IERC20Permit(address(paymentToken)).permit(msg.sender, address(this), price, deadline, v, r, s) {} catch {}
        uint256 allowance = paymentToken.allowance(msg.sender, address(this));
        if (allowance < price) revert PermitAllowanceTooLow(allowance, price);
        _buy(listingId);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Listings `firstId` .. `firstId + count - 1` (clamped to existing ids and MAX_PAGE), active or not.
    function listingsPage(uint256 firstId, uint256 count) external view returns (Listing[] memory page) {
        if (firstId == 0) firstId = 1;
        if (count > MAX_PAGE) count = MAX_PAGE;
        if (count == 0 || firstId > listingCount) return new Listing[](0);
        uint256 last = firstId + count - 1;
        if (last > listingCount) last = listingCount;
        page = new Listing[](last - firstId + 1);
        for (uint256 id = firstId; id <= last; ++id) {
            page[id - firstId] = listings[id];
        }
    }

    /// @notice True if `listingId` is active, its seller still owns the token and the marketplace may still move it.
    function isBuyable(uint256 listingId) external view returns (bool) {
        Listing storage l = listings[listingId];
        if (!l.active) return false;
        if (collection.ownerOf(l.tokenId) != l.seller) return false;
        return _isApproved(l.seller, l.tokenId);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    function _buy(uint256 listingId) private {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive(listingId);
        address seller = l.seller;
        if (seller == msg.sender) revert SellerIsBuyer(listingId);
        uint256 tokenId = l.tokenId;
        uint256 price = l.price;
        if (collection.ownerOf(tokenId) != seller) revert StaleListing(listingId);
        l.active = false;
        delete activeListingOf[tokenId];
        emit Sold(listingId, seller, msg.sender, tokenId, price);
        paymentToken.safeTransferFrom(msg.sender, seller, price);
        collection.safeTransferFrom(seller, msg.sender, tokenId);
    }

    function _isApproved(address owner, uint256 tokenId) private view returns (bool) {
        return collection.getApproved(tokenId) == address(this) || collection.isApprovedForAll(owner, address(this));
    }
}

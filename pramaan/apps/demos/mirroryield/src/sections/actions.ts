import { formatUnits } from "viem";
import { el, statusLine, toast, txLinkNode } from "../ui";
import { fmt, parseAmount } from "../lib/format";
import { sendTx, type TxUi } from "../lib/tx";
import { farmAbi, tokenAbi } from "../abi";
import { FARM, TOKEN, state, getSession, refresh, subscribe } from "../state";

export function createActionsSection(): HTMLElement {
  const container = el("section", { class: "card actions-card", "aria-labelledby": "actions-heading" });

  const heading = el(
    "div",
    { class: "card-header" },
    el("h2", { id: "actions-heading", class: "card-title" }, "Staking Actions")
  );

  const status = statusLine();
  const linkBox = el("div", { class: "tx-link-container" });

  const txUi: TxUi = {
    status(text, kind) {
      status.set(text, kind);
      if (kind === "error" || kind === "ok") {
        toast(text, kind);
      }
    },
    link(hash) {
      linkBox.replaceChildren(txLinkNode(hash));
    },
  };

  // 1. Stake card
  const stakeInput = el("input", {
    id: "stake-amount",
    type: "text",
    inputmode: "decimal",
    class: "input-field mono",
    placeholder: "0.0",
    autocomplete: "off",
  });

  const stakeMaxBtn = el("button", { type: "button", class: "btn-max" }, "Max");
  stakeMaxBtn.addEventListener("click", () => {
    if (state.tokenBalance > 0n) {
      stakeInput.value = formatUnits(state.tokenBalance, state.tokenDecimals);
      renderStakeButtons();
    }
  });

  const stakeBtnContainer = el("div", { class: "btn-group" });

  let isSubmitting = false;

  async function handleApprove(amount: bigint) {
    const session = getSession();
    if (!session) return;
    isSubmitting = true;
    renderStakeButtons();
    try {
      const ok = await sendTx(
        `Approve ${fmt(amount, state.tokenDecimals)} ${state.tokenSymbol}`,
        () =>
          session.wallet.writeContract({
            account: session.address,
            chain: null,
            address: TOKEN,
            abi: tokenAbi,
            functionName: "approve",
            args: [FARM, amount],
          }),
        txUi
      );
      if (ok) {
        await refresh();
      }
    } finally {
      isSubmitting = false;
      renderStakeButtons();
    }
  }

  async function handleStake(amount: bigint) {
    const session = getSession();
    if (!session) return;
    isSubmitting = true;
    renderStakeButtons();
    try {
      const ok = await sendTx(
        `Stake ${fmt(amount, state.tokenDecimals)} ${state.tokenSymbol}`,
        () =>
          session.wallet.writeContract({
            account: session.address,
            chain: null,
            address: FARM,
            abi: farmAbi,
            functionName: "stake",
            args: [amount],
          }),
        txUi
      );
      if (ok) {
        stakeInput.value = "";
        await refresh();
      }
    } finally {
      isSubmitting = false;
      renderStakeButtons();
    }
  }

  function getStakeAmount(): bigint | null {
    const val = stakeInput.value.trim();
    if (!val) return null;
    try {
      return parseAmount(val, state.tokenDecimals);
    } catch {
      return null;
    }
  }

  function renderStakeButtons() {
    stakeBtnContainer.replaceChildren();
    const session = getSession();

    if (!session) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "btn btn-primary",
          disabled: true,
          title: "Connect wallet to stake",
        },
        "Connect Wallet to Stake"
      );
      stakeBtnContainer.appendChild(btn);
      return;
    }

    const amount = getStakeAmount();
    if (amount === null || amount === 0n) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "btn btn-primary",
          disabled: true,
          title: "Enter a positive amount to stake",
        },
        "Stake"
      );
      stakeBtnContainer.appendChild(btn);
      return;
    }

    if (amount > state.tokenAllowance) {
      // Step 1: Approve exact amount
      const approveBtn = el(
        "button",
        {
          type: "button",
          class: "btn btn-accent",
          disabled: isSubmitting,
          onClick: () => handleApprove(amount),
        },
        `1. Approve exactly ${fmt(amount, state.tokenDecimals)} ${state.tokenSymbol}`
      );
      const stakeDisabledBtn = el(
        "button",
        {
          type: "button",
          class: "btn btn-primary",
          disabled: true,
          title: "Approve allowance before staking",
        },
        "2. Stake"
      );
      stakeBtnContainer.append(approveBtn, stakeDisabledBtn);
    } else {
      const stakeBtn = el(
        "button",
        {
          type: "button",
          class: "btn btn-primary",
          disabled: isSubmitting,
          onClick: () => handleStake(amount),
        },
        `Stake ${fmt(amount, state.tokenDecimals)} ${state.tokenSymbol}`
      );
      stakeBtnContainer.appendChild(stakeBtn);
    }
  }

  stakeInput.addEventListener("input", renderStakeButtons);

  const stakeCard = el(
    "div",
    { class: "action-box" },
    el("h3", { class: "action-title" }, "Stake Tokens"),
    el(
      "div",
      { class: "input-group" },
      el("label", { for: "stake-amount", class: "input-label" }, `Amount to Stake (${state.tokenSymbol})`),
      el("div", { class: "input-wrapper" }, stakeInput, stakeMaxBtn)
    ),
    stakeBtnContainer
  );

  // 2. Unstake card
  const unstakeInput = el("input", {
    id: "unstake-amount",
    type: "text",
    inputmode: "decimal",
    class: "input-field mono",
    placeholder: "0.0",
    autocomplete: "off",
  });

  const unstakeMaxBtn = el("button", { type: "button", class: "btn-max" }, "Max");
  unstakeMaxBtn.addEventListener("click", () => {
    if (state.staked > 0n) {
      unstakeInput.value = formatUnits(state.staked, state.tokenDecimals);
      renderUnstakeButton();
    }
  });

  const unstakeBtnContainer = el("div", { class: "btn-group" });

  async function handleUnstake(amount: bigint) {
    const session = getSession();
    if (!session) return;
    isSubmitting = true;
    renderUnstakeButton();
    try {
      const ok = await sendTx(
        `Unstake ${fmt(amount, state.tokenDecimals)} ${state.tokenSymbol}`,
        () =>
          session.wallet.writeContract({
            account: session.address,
            chain: null,
            address: FARM,
            abi: farmAbi,
            functionName: "unstake",
            args: [amount],
          }),
        txUi
      );
      if (ok) {
        unstakeInput.value = "";
        await refresh();
      }
    } finally {
      isSubmitting = false;
      renderUnstakeButton();
    }
  }

  function getUnstakeAmount(): bigint | null {
    const val = unstakeInput.value.trim();
    if (!val) return null;
    try {
      return parseAmount(val, state.tokenDecimals);
    } catch {
      return null;
    }
  }

  function renderUnstakeButton() {
    unstakeBtnContainer.replaceChildren();
    const session = getSession();

    if (!session) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "btn btn-secondary",
          disabled: true,
          title: "Connect wallet to unstake",
        },
        "Connect Wallet to Unstake"
      );
      unstakeBtnContainer.appendChild(btn);
      return;
    }

    if (state.staked === 0n) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "btn btn-secondary",
          disabled: true,
          title: "No staked tokens to unstake",
        },
        "Unstake"
      );
      unstakeBtnContainer.appendChild(btn);
      return;
    }

    const amount = getUnstakeAmount();
    const isInvalid = amount === null || amount === 0n;

    const btn = el(
      "button",
      {
        type: "button",
        class: "btn btn-secondary",
        disabled: isSubmitting || isInvalid,
        title: isInvalid ? "Enter an amount to unstake" : "Unstake tokens from pool",
        onClick: () => {
          if (amount) void handleUnstake(amount);
        },
      },
      amount ? `Unstake ${fmt(amount, state.tokenDecimals)} ${state.tokenSymbol}` : "Unstake"
    );
    unstakeBtnContainer.appendChild(btn);
  }

  unstakeInput.addEventListener("input", renderUnstakeButton);

  const unstakeCard = el(
    "div",
    { class: "action-box" },
    el("h3", { class: "action-title" }, "Unstake Tokens"),
    el(
      "div",
      { class: "input-group" },
      el("label", { for: "unstake-amount", class: "input-label" }, `Amount to Unstake (${state.tokenSymbol})`),
      el("div", { class: "input-wrapper" }, unstakeInput, unstakeMaxBtn)
    ),
    unstakeBtnContainer
  );

  // 3. Claim & Exit card
  const claimBtnContainer = el("div", { class: "quick-actions-grid" });

  async function handleClaim() {
    const session = getSession();
    if (!session) return;
    isSubmitting = true;
    renderQuickActions();
    try {
      const ok = await sendTx(
        "Claim Rewards",
        () =>
          session.wallet.writeContract({
            account: session.address,
            chain: null,
            address: FARM,
            abi: farmAbi,
            functionName: "claim",
            args: [],
          }),
        txUi
      );
      if (ok) {
        await refresh();
      }
    } finally {
      isSubmitting = false;
      renderQuickActions();
    }
  }

  async function handleExit() {
    const session = getSession();
    if (!session) return;
    isSubmitting = true;
    renderQuickActions();
    try {
      const ok = await sendTx(
        "Exit Pool",
        () =>
          session.wallet.writeContract({
            account: session.address,
            chain: null,
            address: FARM,
            abi: farmAbi,
            functionName: "exit",
            args: [],
          }),
        txUi
      );
      if (ok) {
        unstakeInput.value = "";
        await refresh();
      }
    } finally {
      isSubmitting = false;
      renderQuickActions();
    }
  }

  function renderQuickActions() {
    claimBtnContainer.replaceChildren();
    const session = getSession();

    const canClaim = Boolean(session && state.earned > 0n);
    const claimBtn = el(
      "button",
      {
        type: "button",
        class: "btn btn-claim",
        disabled: isSubmitting || !canClaim,
        title: !session
          ? "Connect wallet first"
          : state.earned === 0n
          ? "You have no rewards to claim yet."
          : "Claim earned rewards",
        onClick: handleClaim,
      },
      canClaim
        ? `Claim ${fmt(state.earned, state.tokenDecimals)} ${state.tokenSymbol}`
        : "Claim Rewards"
    );

    const canExit = Boolean(session && (state.staked > 0n || state.earned > 0n));
    const exitBtn = el(
      "button",
      {
        type: "button",
        class: "btn btn-exit",
        disabled: isSubmitting || !canExit,
        title: !session
          ? "Connect wallet first"
          : !canExit
          ? "Nothing to unstake or claim"
          : "Unstake everything and claim rewards in one transaction",
        onClick: handleExit,
      },
      "Exit (Unstake All & Claim)"
    );

    claimBtnContainer.append(claimBtn, exitBtn);
  }

  function renderAll() {
    renderStakeButtons();
    renderUnstakeButton();
    renderQuickActions();
  }

  renderAll();
  subscribe(renderAll);

  container.append(
    heading,
    el("div", { class: "actions-grid" }, stakeCard, unstakeCard),
    el(
      "div",
      { class: "action-box full-width" },
      el("h3", { class: "action-title" }, "Claim & Exit"),
      claimBtnContainer
    ),
    status.node,
    linkBox
  );

  return container;
}

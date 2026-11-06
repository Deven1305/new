export type ThemeChoice = "light" | "dark";

const KEY = "pramaan.theme";

export function systemTheme(): ThemeChoice {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** The explicit choice, if the user made one. localStorage may be blocked; the OS preference then applies. */
export function storedTheme(): ThemeChoice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(choice: ThemeChoice | null): void {
  const root = document.documentElement;
  if (choice) root.setAttribute("data-theme", choice);
  else root.removeAttribute("data-theme");
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // not persisted; still applied for this page
  }
  applyTheme(choice);
}

export function effectiveTheme(): ThemeChoice {
  return storedTheme() ?? systemTheme();
}

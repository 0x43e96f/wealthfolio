// Which of the two looks to wear. The main site keeps the owner's choice in localStorage under
// "mq-theme" ("light" | "dark"; nothing kept means dark) and this page is served from the same
// origin, so it reads the same key, and follows along at once when the switch in the site's top bar
// is pressed while this page is open in its frame. The page's security policy allows no inline
// script, which is why this is a module and not a line in mobiquant.html.
const KEY = "mq-theme";

export function chosenLook(): "light" | "dark" {
  try {
    return window.localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark"; // storage refused (private mode): the site's default
  }
}

export function wearLook(): void {
  document.documentElement.classList.toggle("dark", chosenLook() === "dark");
}

export function followLook(): void {
  wearLook();
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) wearLook();
  });
}

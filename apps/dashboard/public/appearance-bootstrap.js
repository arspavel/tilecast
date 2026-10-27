(() => {
  try {
    const value = localStorage.getItem("tilecast.appearance");
    document.documentElement.dataset.theme = [
      "light",
      "dark",
      "system",
    ].includes(value)
      ? value
      : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();

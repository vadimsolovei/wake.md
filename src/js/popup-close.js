const closeButtonEl = document.getElementById("close-popup");
const telegramIcon = document.getElementById("telegram");
const popup = document.getElementById("popup");

const onCloseButtonClick = () => {
  popup.style.display = "none";
  telegramIcon.classList.remove("active");
};

closeButtonEl.addEventListener("click", onCloseButtonClick);

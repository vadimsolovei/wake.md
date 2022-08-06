const closeButtonEl = document.querySelector(".socials__popup-close");
const telegramIcon = document.querySelector(".telegram");
const popup = document.querySelector(".socials__popup");

const onCloseButtonClick = () => {
  popup.style.display = "none";
  telegramIcon.classList.remove("active");
};

closeButtonEl.addEventListener("click", onCloseButtonClick);

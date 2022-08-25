const bodyEl = document.querySelector("body");
const closeButtonEl = document.querySelector(".js-popup_close");
const popup = document.querySelector(".js-popup");
const popupOpener = document.querySelectorAll(".js-popup_opener");

const onCloseButtonClick = () => {
  popup.classList.remove("active");
  bodyEl.classList.remove("popup-active");
};

const onOpenPopupClick = (e) => {
  e.preventDefault();
  popup.classList.add("active");
  bodyEl.classList.add("popup-active");
};

closeButtonEl.addEventListener("click", onCloseButtonClick);
popupOpener.forEach(opener => {
  opener.addEventListener("click", onOpenPopupClick);
})

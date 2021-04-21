// Smooth scroll to element
const targetElement = document.getElementById("grid");
const scrollButton = document.querySelector(".hero__chevron");
scrollButton.addEventListener("click", clickHandler);

function clickHandler(e) {
  e.preventDefault();
  const offsetTop = targetElement.offsetTop - 80;
  console.log(offsetTop);

  scroll({
    top: offsetTop,
    behavior: "smooth",
  });
}

// Add opacity on scroll
const checkpoint = 600;

window.addEventListener("scroll", () => {
  const currentScroll = window.pageYOffset;
  if (currentScroll <= checkpoint) {
    opacity = 1 - currentScroll / checkpoint + 0.1;
  } else {
    opacity = 0.1;
  }
  document.querySelector(".hero__background").style.opacity = opacity;
});

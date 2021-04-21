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

// Show sticky footer on scroll
const triggerScrollHeight = 700;

window.addEventListener("scroll", () => {
  if (window.innerWidth < 768) {
    const currentScroll = window.pageYOffset;
    if (
      currentScroll > triggerScrollHeight &&
      currentScroll < document.body.offsetHeight - 800
    ) {
      document.querySelector(".footer_sticky").style.display = "block";
      // document.querySelector(".hero__socials").style.display = "none";
    } else {
      document.querySelector(".footer_sticky").style.display = "none";
      // document.querySelector(".hero__socials").style.display = "flex";
    }
  } else {
    document.querySelector(".footer_sticky").style.display = "none";
    // document.querySelector(".hero__socials").style.display = "none";
  }
});

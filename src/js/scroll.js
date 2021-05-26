// Add opacity on scroll
const checkpoint = 600;

const opacityOnScroll = () => {
  const currentScroll = window.scrollY;
  if (currentScroll <= checkpoint) {
    opacity = 1 - currentScroll / checkpoint + 0.1;
  } else {
    opacity = 0.1;
  }
  document.querySelector(".hero__background").style.opacity = opacity;
};

window.addEventListener("scroll", opacityOnScroll);

// Show sticky footer on scroll
const triggerScrollHeight = 1;
const footerSticky = document.querySelector(".footer_sticky");
const heroSocials = document.querySelector(".hero__socials");
const heroText = document.querySelector(".hero__text");

const toggleFooterSticky = () => {
  const currentScroll = window.scrollY;
  if (
    window.innerWidth < 768 ||
    (window.innerWidth > 768 && window.innerHeight < 575)
  ) {
    if (currentScroll > triggerScrollHeight) {
      footerSticky.style.backgroundColor = "#2f3e53";
      footerSticky.classList.remove("hidden");
      heroText.style.opacity = 1;
    }
    if (currentScroll < triggerScrollHeight) {
      footerSticky.style.backgroundColor = "transparent";
      heroText.style.opacity = 0;
    }
    if (currentScroll + window.innerHeight > document.body.offsetHeight - 100) {
      footerSticky.classList.add("hidden");
    }
  } else {
    footerSticky.style.backgroundColor = "transparent";
    heroText.style.opacity = 1;
  }
};

window.addEventListener("scroll", toggleFooterSticky);
window.addEventListener("resize", toggleFooterSticky);

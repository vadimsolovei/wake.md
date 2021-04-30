// Smooth scroll to element
const promoElement = document.getElementById("promo");
const scrollButton = document.querySelector(".hero__chevron");

function clickHandler(e) {
  e.preventDefault();
  const offsetTop = promoElement.offsetTop - 80;

  scroll({
    top: offsetTop,
    behavior: "smooth",
  });
}

scrollButton.addEventListener("click", clickHandler);

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
const triggerScrollHeight = 700;
const footerSticky = document.querySelector(".footer_sticky");

const toggleFooterSticky = () => {
  const currentScroll = window.scrollY;
  if (window.innerWidth < 768) {
    if (currentScroll > triggerScrollHeight) {
      footerSticky.classList.remove("hidden");
    }
    if (
      currentScroll + window.innerHeight > document.body.offsetHeight - 100 ||
      currentScroll < triggerScrollHeight
    ) {
      footerSticky.classList.add("hidden");
    }
  } else {
    footerSticky.classList.add("hidden");
  }
};

window.addEventListener("scroll", toggleFooterSticky);

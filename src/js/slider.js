import Splide from "@splidejs/splide";

new Splide("#splide", {
  type: "loop",
  padding: {
    left: "75px",
    right: "75px",
  },
  autoWidth: true,
  focus: "center",
  gap: "15px",
  pagination: false,
  arrows: false,
  autoplay: true,
  interval: 2500
}).mount();

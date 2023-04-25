const booking = document.querySelector("#popup_booking");
if (booking) {
  const personsNumberEl = document.querySelectorAll('input[name="persons_number"]');
  const bookingPriceEl = document.querySelector('.js-booking_price');
  var bookingPrice = document.querySelector('input[name="persons_number"]:checked').value;

  bookingPriceEl.innerHTML = bookingPrice;

  for (var i = 0; i < personsNumberEl.length; i++) {
    personsNumberEl[i].addEventListener('change', function() {
      bookingPrice = document.querySelector('input[name="persons_number"]:checked').value;
      bookingPriceEl.innerHTML = bookingPrice;
    });
  }

}

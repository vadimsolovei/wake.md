import { RequestManager, Client, HTTPTransport} from "@open-rpc/client-js";
import datepicker from 'js-datepicker'

const loginTransport = new HTTPTransport('https://user-api.simplybook.me' + '/login');
const loginRequestManager = new RequestManager([loginTransport]);
const loginClient = new Client(loginRequestManager);
const todayDate = new Date();
const submitButton = document.getElementById('booking_submit')
const agreeTerms = document.getElementById('agree_terms')
const timesEl = document.getElementById('booking_slots')
const timesEmptyEl = document.querySelector('[data-times-empty]')

const name = document.getElementById('first_name')
const phone = document.getElementById('phone_number')
const email = document.getElementById('email')

const textInputs = document.querySelectorAll('.form__field input');

let companyClient
let token
let events
let eventsNext
let eventsDays = []
let firstAvailableDate
let firstTimeSlots
let selectedDate
let selectedTime

const login = async () => {
  token = await loginClient.request({method: 'getToken', params: ['mdwake', 'd176a78ad9784e86894dac99506c7beaced5668ea2becf46d835a866ef9a7e42']});
};

login().then(() => {
  let clientTransport = new HTTPTransport('https://user-api.simplybook.me');


  clientTransport.headers.set('X-Company-Login', 'mdwake');
  clientTransport.headers.set('X-Token', token);


  const clientRequestManager = new RequestManager([clientTransport]);
  companyClient = new Client(clientRequestManager);

  fetchData();
}); 

const fetchData = () => {
  getAvailableDates().then(() => {
    prepareFirstData();
    renderTimes(firstTimeSlots);
    initCalendar();
  });  
};

const updateTimeSlots = (date) => {
  timesEl.innerHTML = '';
  timesEl.closest('.form__block').classList.add('-loading');
  timesEmptyEl.style.display = "none";

  getAvailableDates(date).then(() => {
    renderTimes(events[formatDate(selectedDate)]);
  });  
};

const getAvailableDates = async (date) => {
  let dateFrom 
  let dateTo 

  if (date == null) {
    dateFrom = formatDate();
    dateTo = addToDate(null, 'month', 1);
    dateTo = formatDate(dateTo);
  } else {
    dateFrom = formatDate(date);
    dateTo = formatDate(date);
  }

  let serviceId = 2;
  let performerId = null;
  let qty = 1;


  events = await companyClient.request({method: 'getStartTimeMatrix', params: [dateFrom, dateTo, serviceId, performerId, qty]});

  return events
  
};

const prepareFirstData = () => {
  for (var key in events) {
    // skip loop if the property is from prototype
    if (!events.hasOwnProperty(key)) continue;

    var event = events[key];

    // skip empty days
    if (!event.length) continue;
    if (firstAvailableDate == null) {
      firstAvailableDate = new Date(key);
      selectedDate = key;
    };

    firstTimeSlots = event;

    break;

  };
};


const renderTimes = (timeSlots) => {
  if (timeSlots.length == 0) {
    timesEmptyEl.style.display = "block";
  } else {
    timesEmptyEl.style.display = "none";
  }

  timesEl.closest('.form__block').classList.remove('-loading')
  timesEl.innerHTML = '';


  timeSlots.forEach((time) => {
    let timeArr = time.split(':');
    let untilArr = [];

    if (timeArr[1] == '00') {
      untilArr[0] = timeArr[0];
      untilArr[1] = '30'
    } else {
      untilArr[0] = parseInt(timeArr[0]) + 1;
      untilArr[1] = '00'
    }

    timesEl.innerHTML += '<span data-booking-time="' + time + '">' + timeArr[0] + ':' + timeArr[1] + ' &mdash; ' + untilArr[0] + ':' + untilArr[1] + '</span>'
  });

  const time = document.querySelectorAll('[data-booking-time]');

  time[0].classList.add('-active');
  selectedTime = time[0].dataset.bookingTime;
  updateSubmitButton();

  time.forEach(timeSlot => {
    timeSlot.addEventListener("click", onTimeClick);
  });
};

const onTimeClick = (e) => {
  const time = document.querySelectorAll('[data-booking-time]');
  time.forEach(timeSlot => {
    timeSlot.classList.remove('-active');
  });
  e.target.classList.add('-active');

  selectedTime = e.target.dataset.bookingTime;

  updateSubmitButton();
};

const initCalendar = () => {
  let datepickerEl = document.querySelector('#datepicker');
  let months = JSON.parse(datepickerEl.dataset.months);
  let days = JSON.parse(datepickerEl.dataset.days);
  
  const picker = datepicker('#datepicker', {
    alwaysShow: true,
    showAllDates: true,
    dateSelected: firstAvailableDate,
    startDay: 1,
    disableYearOverlay: true,
    minDate: new Date(),
    maxDate: new Date(2023, 9, 31),
    disabler: date => [1,2,3,4,5].includes(date.getDay()), // weekend days only,
    customMonths: months,
    customDays: days,
    onSelect: (instance, date) => {
      selectedDate = formatDate(date);
      updateTimeSlots(date);
      
      selectedTime = null;
      updateSubmitButton();
    }
  });

};

const formatDate = (date) => {
  if (date == null) {
    date = todayDate;
  };
  date = new Date(date);
  return date.getFullYear() + "-" + ("0"+(date.getMonth()+1)).slice(-2) + "-" + ("0" + date.getDate()).slice(-2)
};

const addToDate = (date, type, ammount) => {
  if (date == null) {
    date = todayDate;
  };
  let newDate = date;

  switch (type) {
    case 'day':
      newDate.setDate(date.getDate() + ammount);
      break;
    case 'month':
      newDate.setMonth(date.getMonth() + ammount);
      break;
  };

  return newDate;
};

const updateSubmitButton = () => {
  if (selectedTime != null && agree_terms.checked) {
    submitButton.disabled = false;
  } else {
    submitButton.disabled = true;  
  }
};

const submitFormAjax = () => {
  validateFields();
  // let xmlhttp= window.XMLHttpRequest ?
  //     new XMLHttpRequest() : new ActiveXObject("Microsoft.XMLHTTP");

  // xmlhttp.onreadystatechange = function() {
  //     if (this.readyState === 4 && this.status === 200)
  //         alert(this.responseText); // Here is the response
  // }

  let clientData = {
    'name' : name.value,
    'phone' : phone.value,
    'email' : email.valuel
  }

  // companyClient.request({method: 'book', params: [2, 2, selectedDate, selectedTime, clientData]});

  // xmlhttp.open("POST","booking.php",true);
  // xmlhttp.setRequestHeader("Content-type","application/x-www-form-urlencoded");
  // xmlhttp.send("date=" + selectedDate + "&time=" + selectedTime + "&name=" + name + "&phone=" + phone + "&email=" + email);
}

const validateFields = () => {
  textInputs.forEach((input) => {
    if (input.value == '') {
      input.closest('.form__field').classList.add('-error');
    }
  });

  if (email.value.match(
    /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
  )) {
    email.closest('.form__field').classList.remove('-error');
  } else {
    email.closest('.form__field').classList.add('-error');
  }

  if (phone.value.length < 8) {
    phone.closest('.form__field').classList.add('-error');
  } else {
    phone.closest('.form__field').classList.remove('-error');
  }

}

const addListeners = () => {
  // Check terms agreed
  agree_terms.addEventListener('change', (e) => {
    updateSubmitButton();
  });

  // On button submit
  submitButton.onclick = (e) => {
    e.preventDefault();
    if (submitButton.disabled) { 
      return
    } else {
      submitFormAjax()
    };
  };

  // Clear validation inputs on focusout
  textInputs.forEach((input) => {
    input.addEventListener('focusin', (e) => {
        e.target.closest('.form__field').classList.remove('-error');
    });
  });

};

addListeners();
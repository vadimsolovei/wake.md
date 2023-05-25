import { RequestManager, Client, HTTPTransport} from "@open-rpc/client-js";
import datepicker from 'js-datepicker'

const loginTransport = new HTTPTransport('https://user-api.simplybook.me' + '/login');
const loginRequestManager = new RequestManager([loginTransport]);
const loginClient = new Client(loginRequestManager);
const todayDate = new Date();


let companyClient
let token
let events
let eventsNext
let eventsDays = []
let firstAvailableDate
let firstTimeSlots
let selectedDate

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
    };

    firstTimeSlots = event;

    break;

  };
};


const renderTimes = (timeSlots) => {
  let timesEl = document.querySelector('#booking_slots')
  let timesEmptyEl = document.querySelector('[data-times-empty]')
  
  if (timeSlots.length == 0) {
    timesEmptyEl.style.display = "block";
  } else {
    timesEmptyEl.style.display = "none";
  }

  timesEl.innerHTML = '';

  timeSlots.forEach(time => timesEl.innerHTML += '<span data-booking-time>' + time + '</span>');

  const time = document.querySelectorAll('[data-booking-time]');

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
      selectedDate = date;
      updateTimeSlots(date);
    }
  });

};

const formatDate = (date) => {
  if (date == null) {
    date = todayDate;
  };
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




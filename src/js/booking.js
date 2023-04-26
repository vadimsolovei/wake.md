import { RequestManager, Client, HTTPTransport} from "@open-rpc/client-js";

const loginTransport = new HTTPTransport('https://user-api.simplybook.me' + '/login');
const loginRequestManager = new RequestManager([loginTransport]);
const loginClient = new Client(loginRequestManager);

let token
let events

const login = async () => {
  token = await loginClient.request({method: 'getToken', params: ['wakemd', '8bed206feed9dd8f2e24fc616bfb4b300fcab3e7a34b2d0cd2b9cd3efab55901']});
};

login().then(() => {
  fetchData();
}); 

const fetchData = () => {
  let clientTransport = new HTTPTransport('https://user-api.simplybook.me');


  clientTransport.headers.set('X-Company-Login', 'wakemd');
  clientTransport.headers.set('X-Token', token);


  const clientRequestManager = new RequestManager([clientTransport]);
  const companyClient = new Client(clientRequestManager);

  const company = async () => {
    // let year = 2020;
    // let month = 5;
    // let performerId = null;

    let dateFrom = '2023-04-29';
    let dateTo = '2023-04-30';
    let serviceId = 2;
    let performerId = null;
    let qty = 1;

    events = await companyClient.request({method: 'getStartTimeMatrix', params: [dateFrom, dateTo, serviceId, performerId, qty]});
  };

  company().then(() => {
    console.log(events);
    for (var key in events) {
      // skip loop if the property is from prototype
      if (!events.hasOwnProperty(key)) continue;


      var event = events[key];

      let li = document.createElement('li');
      li.classList.add('form__row_item');
      
      li.innerHTML += '<p>' + key + '</p>';
      
      event.forEach(time => li.innerHTML += '<span data-booking-time>' + time + '</span>');
      
      document.querySelector('#booking_dates').appendChild(li)
      // for (var prop in event) {
      //   // skip loop if the property is from prototype
      //   if (!event.hasOwnProperty(prop)) continue;    
      // }

      const time = document.querySelectorAll('[data-booking-time]');
      console.log(time);
      time.forEach(timeSlot => {
        timeSlot.addEventListener("click", onTimeClick);
      });
    };
  });  
};

const onTimeClick = (e) => {
  e.target.classList.toggle('-active');
};



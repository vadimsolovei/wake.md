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
    events = await companyClient.request({method: 'getWorkCalendar', params: ['2023', '05', '2']});
  };

  company().then(() => {
    console.log(events);
  });  
};
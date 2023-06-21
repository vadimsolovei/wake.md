<?php
namespace Simplybook;
include 'JsonRpcClient.php';
use Simplybook\JsonRpcClient;

$loginClient = new JsonRpcClient('https://user-api.simplybook.me' . '/login');
$token = $loginClient->getToken('mdwake', 'd176a78ad9784e86894dac99506c7beaced5668ea2becf46d835a866ef9a7e42');


$client = new JsonRpcClient('https://user-api.simplybook.me', array(
    'headers' => array(
        'X-Company-Login: ' . 'mdwake',
        'X-Token: ' . $token
    )
));

$clientData = array(
    'name' => 'vladislav',
    'email' => 'slavdis@ya.ru',
    'phone' => '+37379651456'
);

// $clientId = $client->addClient($clientData);


// $bookingsInfo = $client->book(2, 2, $clientId, '2023-06-18', '16:00:00', $clientData);

// var_dump($bookingsInfo);

$sign = md5('26' . '232b9f0044e75cd0c65be26e0a890978' . '5996d2b997d20558c14013e7945020da8853331721f3bb22bc5e16a14242c461');
   $result = $client->confirmBookingPayment('26', 'manual', $sign);
   echo '<br>Confirm result</b><br />';
   var_dump($result);







// $bookingsInfo = $client->book(2, 2, $clientId, '2023-04-30', '16:30:00', $clientData);
// echo "\r\n";
// var_dump($bookingsInfo);

// $bookingsInfo = $client->book(2, 2, $clientId, '2023-04-30', '17:00:00', $clientData);
// echo "\r\n";
// var_dump($bookingsInfo);

// $params =[
// "date_from"=>"2015-12-29",
// "date_to"=>"2015-12-29",
// "booking_type"=>"cancelled",
// "event_id"=>"5",
// "order"=>"start_date"
// ];

// $bookings = $client->getBookings($params);

?>
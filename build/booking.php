<?php
namespace Simplybook;
include 'JsonRpcClient.php';
use Simplybook\JsonRpcClient;

$loginClient = new JsonRpcClient('https://user-api.simplybook.me' . '/login');
$token = $loginClient->getUserToken('wakemd', 'slavdis', 'xyxkef-4mujbi-zEdkym');
var_dump($token);


$client = new JsonRpcClient('https://user-api.simplybook.me' . '/admin/', array(
'headers' => array(
'X-Company-Login: ' . 'wakemd',
'X-User-Token: ' . $token
)
));

$clientData = array(
    'name' => 'vladislav',
    'email' => 'slavdis@ya.ru',
    'phone' => '+37379651456'
);

$clientId = $client->addClient($clientData);

// $bookingsInfo = $client->book(2, 2, $clientId, '2023-04-30', '10:30:00', $clientData);
// echo "\n";
// var_dump($bookingsInfo);
$bookingsInfo = $client->book(2, 2, $clientId, '2023-04-29', '12:00:00', $clientData);
echo "\r\n";
var_dump($bookingsInfo);

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
<?php
namespace Simplybook;
include 'JsonRpcClient.php';
use Simplybook\JsonRpcClient;

$loginClient = new JsonRpcClient('https://user-api.simplybook.me' . '/login');
$token = $loginClient->getUserToken('mdwake', 'slavdislav', 'bomnes-9wotpi-dyXvoq');


$client = new JsonRpcClient('https://user-api.simplybook.me' . '/admin', array(
    'headers' => array(
        'X-Company-Login: ' . 'mdwake',
        'X-User-Token: ' . $token
    )
));

// $date=$_POST['date'];
// $time=$_POST['time'];

$clientData = array(
    // 'name' => $_POST['name'],
    // 'email' => $_POST['email'],
    // 'phone' => $_POST['phone']
    'name' => 'testing',
    'email' => 'slavdis@ya.ru',
    'phone' => '+37300000000'
);


$clientId = $client->addClient($clientData);


$bookingsInfo = $client->book(2, 2, $clientId, '2023-06-18', '16:00:00', $clientData);

var_dump($bookingsInfo);



// $sign = md5(22 . 'c09ec54c2ce34fa09e21fc384505e1f1' . '5996d2b997d20558c14013e7945020da8853331721f3bb22bc5e16a14242c461');

// $bookingsInfo = $client->confirmBookingPayment(22, 'manual', $sign);


// var_dump($bookingsInfo);



// $json = json_encode(array(
//     "company" => "mdwake",
//     "login" => "slavdislav",
//     "password" => "bomnes-9wotpi-dyXvoq"
// ));


// $channel = curl_init();

// curl_setopt($channel,CURLOPT_URL, 'https://user-api-v2.simplybook.me/admin/auth');
// curl_setopt($channel,CURLOPT_POST, true);
// curl_setopt($channel,CURLOPT_POSTFIELDS, $json );


// curl_setopt($channel,CURLOPT_RETURNTRANSFER, true); 

// //execute post
// $result = curl_exec($channel);
// $resArr = json_decode($result);


// $token = $resArr->token;


// $headers = array(
//     "Content-Type" => "application/json",
//     "X-Company-Login" => "mdwake",
//     "X-Token" => $token
// );

// $json = json_encode(array(
//     "payment_processor" => "manual"
// ));


// $channel = curl_init('https://user-api-v2.simplybook.me/admin/invoices/22/accept-payment');
// curl_setopt($channel, CURLOPT_RETURNTRANSFER, true);
// curl_setopt($channel, CURLOPT_CUSTOMREQUEST, "PUT");
// curl_setopt($channel, CURLOPT_HTTPHEADER, $headers);
// curl_setopt($channel, CURLOPT_POSTFIELDS, $json);
// curl_setopt($channel, CURLOPT_SSL_VERIFYPEER, false);
// curl_setopt($channel, CURLOPT_CONNECTTIMEOUT, 10);


// $result = curl_exec($channel);

// var_dump($result);
// $statusCode = curl_getInfo($channel, CURLINFO_HTTP_CODE);
// curl_close($channel);    



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
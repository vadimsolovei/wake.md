<?php

namespace WakeMD;

require_once('./vendor/autoload.php');

use Monolog\Handler\StreamHandler;
use Monolog\Logger;
use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\MessageFormatter;
use Maib\MaibApi\MaibClient;


// Log stack
if ((isset($log_is_required) && $log_is_required)) {
  $log = new Logger('maib_guzzle_request');
  $log->pushHandler(new StreamHandler(__DIR__.'/logs/maib_guzzle_request.log', Logger::DEBUG));
  $stack = HandlerStack::create();
  $stack->push(
      Middleware::log($log, new MessageFormatter(MessageFormatter::DEBUG))
  );
}

$options = [
'base_uri' => MaibClient::MAIB_TEST_BASE_URI,
'debug'  => false,
'verify' => true,
'cert'    => [MaibClient::MAIB_TEST_CERT_URL, MaibClient::MAIB_TEST_CERT_PASS],
'ssl_key' => MaibClient::MAIB_TEST_CERT_KEY_URL,
'config'  => [
  'curl'  =>  [
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_SSL_VERIFYPEER => true,
  ]
]
];
if (isset($stack)) {
  $options['handler'] = $stack;
}
$guzzleClient = new Client($options);
$client = new MaibClient($guzzleClient);

// The Parameters required to use MaibClient methods
$amount = 1; // The amount of the transaction
$currency = 978; // The currency of the transaction - is the 3 digits code of currency from ISO 4217
$clientIpAddr = '127.0.0.1'; // The client IP address
$description = 'testing'; // The description of the transaction
$lang = 'ru'; // The language for the payment gateway

// Other parameters
$sms_transaction_id = null;
$dms_transaction_id = null;
$redirect_url = MaibClient::MAIB_TEST_REDIRECT_URL . '?trans_id=';
$sms_redirect_url = '';
$dms_redirect_url = '';

$registerSmsTransaction = $client->registerSmsTransaction($amount, $currency, $clientIpAddr, $description, $lang);
var_dump($registerSmsTransaction);
$sms_transaction_id = $registerSmsTransaction["TRANSACTION_ID"];
$sms_redirect_url = $redirect_url . $sms_transaction_id;

?>
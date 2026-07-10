Embedded Checkout Protocol
The Embedded Checkout Protocol (ECP) enables your application to embed a merchant's checkout UI, receive events as the buyer interacts with checkout, and delegate key actions like address and payment selection to your native experience.

How it works
ECP is a technical bridge that defines how your host application communicates with the embedded checkout:

Load the checkout in a web view using the continue_url with ECP parameters.
Receive events as the buyer progresses through checkout via JSON-RPC 2.0 messages.
Delegate actions like payment instrument selection and address changes to your native UI.
Complete the purchase when checkout signals completion.
ECP draws inspiration from the W3C Payment Request
API
, adapting its mental model for embedded checkout scenarios.

For the full protocol specification, see the ECP
specification
.

Concept W3C Payment Request Embedded Checkout
Initialization new PaymentRequest() Load with continue_url
UI Ready show() returns Promise ec.start notification
Payment Change paymentmethodchange event ec.payment.change notification
Address Change shippingaddresschange event ec.fulfillment.address_change_request
Submit Payment User accepts → PaymentResponse ec.payment.credential_request
Completion response.complete() ec.complete notification
Construct the embedded URL
When you receive a requires_escalation status from from a UCP checkout response (via REST, MCP, or other transport), add ECP query parameters to the continue_url to enable embedded checkout.

See the UCP spec for more
details
.

URL Parameters
ec_version
•
string
Required
The UCP version for this session. Must be 2026-01-23.

ec_auth
•
string
Authentication token in merchant-defined format. Optional if not required by the merchant.

ec_delegate
•
string
Comma-delimited list of delegations the host wants to handle natively. See Delegations.

Embedded URL construction
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
async function createEmbeddedCheckoutURL(checkout) {
const checkoutURL = new URL(checkout.continue_url);

// Retrieve JWT from your server
const authToken = await fetchShopifyAuthenticationJWT();

checkoutURL.searchParams.set('ec_version', '2026-01-23');
checkoutURL.searchParams.set('ec_auth', authToken);
checkoutURL.searchParams.set(
'ec_delegate',
[
'fulfillment.address_change',
'payment.instruments_change',
'payment.credential',
].join(','),
);

return checkoutURL.toString();
}
Example URL
Copy
1
https://example.com/checkout/c/abc123?ec_version=2026-01-23&ec_auth=eyJ...&ec_delegate=fulfillment.address_change,payment.instruments_change,payment.credential
Web view integration
Load the embedded checkout URL in a web view. Communication between your Host and the Embedded Checkout happens through two JavaScript globals:

EmbeddedCheckoutProtocolConsumer: Created by your app. Checkout calls postMessage() to send events to your application.
EmbeddedCheckoutProtocol: Created by Shopify Checkout. Your app calls postMessage() to respond to events.
All messages use JSON-RPC 2.0 format. Messages with an id field are requests that require a response. Messages without id are notifications that don't expect a response.

iOS
Android
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
import WebKit

class CheckoutViewController: UIViewController,
WKScriptMessageHandler {
var webView: WKWebView!

func loadEmbeddedCheckout(url: URL) {
let config = WKWebViewConfiguration()

    // Register message handler
    config.userContentController.add(
      self,
      name: "EmbeddedCheckoutProtocolConsumer"
    )

    webView = WKWebView(frame: view.bounds, configuration: config)
    view.addSubview(webView)
    webView.load(URLRequest(url: url))

}

// Handle messages from Checkout
func userContentController(
\_ controller: WKUserContentController,
didReceive message: WKScriptMessage
) {
// Parse JSON-RPC message
guard let body = message.body as? String,
let data = body.data(using: .utf8),
let json = try? JSONSerialization.jsonObject(
with: data
) as? [String: Any]
else { return }

    let method = json["method"] as? String
    let id = json["id"] as? String

Delegations
Delegations declare which operations your Host handles natively instead of in the Embedded Checkout UI. Each delegation maps to a corresponding \_request message:

ec_delegate value Corresponding message Description
fulfillment.address_change ec.fulfillment.address_change_request Host presents address selection UI
payment.credential ec.payment.credential_request Host authenticates and provides payment credentials
payment.instruments_change ec.payment.instruments_change_request Host presents payment method selection UI
When you accept a delegation:

Embedded checkout fires the \_request message when that action is triggered, and waits for your response.
Your host must respond to every request, including errors if the user cancels.
Embedded checkout doesn't show its own UI for delegated actions.
Event reference
All events use JSON-RPC 2.0 format. Events are either:

Requests (include id): Require a response from your host.
Notifications (no id): Informational only, no response expected.
ec.ready
Broadcast when Embedded Checkout is ready. This initializes the communication channel and indicates which delegations were accepted.

Direction: Embedded Checkout → Host

Type: Request (requires response)

Payload:

delegate: Array of accepted delegation identifiers (subset of what you requested via ec_delegate)
Response:

checkout (optional): Additional display-only state, such as payment.instruments
upgrade (optional): A MessagePort to upgrade communication channel
ec.ready
Request
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
12
{
"jsonrpc": "2.0",
"id": "ready_1",
"method": "ec.ready",
"params": {
"delegate": [
"fulfillment.address_change",
"payment.instruments_change",
"payment.credential"
]
}
}
ec.start
Signals that checkout is visible and ready for buyer interaction.

Direction: Embedded Checkout → Host

Type: Notification (no response)

Payload:

checkout: The current state of the checkout
ec.start
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
{
"jsonrpc": "2.0",
"method": "ec.start",
"params": {
"checkout": {
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"status": "requires_escalation",
"totals": [
{ "type": "subtotal", "amount": 8900 },
{ "type": "total", "amount": 9400 }
],
"line_items": [...]
}
}
}
ec.fulfillment.address_change_request
Requests the host to present address selection UI for shipping.

Direction: Embedded Checkout → Host

Type: Request (requires response)

Payload:

checkout: Current checkout state including fulfillment details
Response:

checkout.fulfillment.methods: Updated methods with selected_destination_id and destinations
ec.fulfillment.address_change_request
Request
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
{
"jsonrpc": "2.0",
"id": "address_1",
"method": "ec.fulfillment.address_change_request",
"params": {
"checkout": {
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"fulfillment": {
"methods": [...]
}
}
}
}
ec.payment.instruments_change_request
Requests the Host to present payment instrument selection UI.

Direction: Embedded Checkout → Host

Type: Request (requires response)

Payload:

checkout: Current checkout state including payment details
Response:

checkout.payment.instruments: Updated array of payment instruments
checkout.payment.selected_instrument_id: ID of the selected instrument
ec.payment.instruments_change_request
Request
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
{
"jsonrpc": "2.0",
"id": "instruments_1",
"method": "ec.payment.instruments_change_request",
"params": {
"checkout": {
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"payment": {...}
}
}
}
ec.payment.credential_request
Requests a payment credential for the selected instrument during checkout submission. This typically involves user authentication (biometric/PIN).

Direction: Embedded Checkout → Host

Type: Request (requires response)

Payload:

checkout: Current checkout state including payment details
Response:

checkout.payment.instruments: Updated instrument array with credential field added to the selected instrument
ec.payment.credential_request
Request
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
{
"jsonrpc": "2.0",
"id": "credential_1",
"method": "ec.payment.credential_request",
"params": {
"checkout": {
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"payment": {
"selected_instrument_id": "pm_1234567890abc"
}
}
}
}
ec.complete
Indicates successful checkout completion.

Direction: Embedded Checkout → Host

Type: Notification (no response)

Payload:

checkout: Final checkout state
order: Order confirmation details
ec.complete
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
{
"jsonrpc": "2.0",
"method": "ec.complete",
"params": {
"checkout": {
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"status": "completed",
"order": {
"id": "gid://shopify/Order/123456789"
}
}
}
}
Error responses
When a user cancels a delegated action, respond with an error:

Error response
Copy
1
2
3
4
5
6
7
8
{
"jsonrpc": "2.0",
"id": "credential_1",
"error": {
"code": "abort_error",
"message": "User cancelled the operation."
}
}

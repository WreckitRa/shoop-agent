Quickstart
Quickstart: Send an Order to Any Merchant
Learn how to integrate the Rye API, from setting up your account to submitting your first order. The example uses Shopify, but the same process works with Amazon, non-Shopify stores, and other merchants.

Build this with AI
Open a pre-built prompt in your preferred AI tool to generate a complete working integration.

Open in Claude

Open in Lovable

Open in ChatGPT

Copy for Cursor

Copy for Copilot

Copy for Claude Code
​
See Rye in Action
Watch a complete order flow — from product URL to purchase confirmation — all without leaving your app.
order-flow
​
Step 1: Create a Rye Account
Create a Rye staging account to get an API key and submit a test order.
​
Step 2: Get Your API Key
Go to the Account tab in your Rye staging account, and copy the Staging API Key.
Set it as an environment variable:
export RYE_API_KEY="YOUR_API_KEY"
​
Step 3: Create a Checkout Intent
Send a POST request to /api/v1/checkout-intents with the product URL and buyer identity.

curl

TypeScript SDK

Python SDK

Java SDK

Ruby SDK
import CheckoutIntents from 'checkout-intents';

const client = new CheckoutIntents({
apiKey: process.env['RYE_API_KEY'],
});

const checkoutIntent = await client.checkoutIntents.create({
buyer: {
address1: '123 Main St',
city: 'New York',
country: 'United States',
email: 'john.doe@example.com',
firstName: 'John',
lastName: 'Doe',
phone: '212-333-2121',
postalCode: '10001',
province: 'NY',
},
productUrl: 'https://flybyjing.com/collections/shop/products/the-big-boi',
quantity: 1,
});
You can send orders to Amazon, Shopify, or other merchants by simply changing the product URL. Example test URLs:
https://www.raakachocolate.com/products/blueberry-lemon?variant=41038993227863
https://www.amazon.com/Apple-MX532LL-A-AirTag/dp/B0CWXNS552/
Orders can only be shipped to U.S. addresses. International shipping is not yet supported. Using a non-US address will cause the checkout intent to fail.
​
Step 4: Poll for awaiting_confirmation
After creating the intent, poll the /api/v1/checkout-intents/{id} endpoint with a GET request until the state is awaiting_confirmation. Use the id from the previous step.

curl

TypeScript SDK

Python SDK

Java SDK

Ruby SDK
const checkoutIntent = await client.checkoutIntents.retrieve('id');
Example response:
{
"state": "awaiting_confirmation"
}
Fetching an offer from the merchant is asynchronous. Always poll the GET endpoint for the latest state of the intent.
Use the failureReason field to display helpful error messages to users.
Use the SDK’s createAndPoll() helper method to complete steps 3 and 4 in a single call.
​
Step 5: Confirm Final Pricing
Before proceeding to payment, inspect the latest checkout intent response to confirm:
Shipping options and costs
Taxes
Total cost
Offer availability
Example response:
{
"id": "ci_4197e51f48290517639402856173049",
"createdAt": "2025-10-14T21:38:52.062Z",
"productUrl": "https://flybyjing.com/collections/shop/products/the-big-boi",
...
"quantity": 1,
"variantSelections": null,
"state": "awaiting_confirmation",
"offer": {
"cost": {
"subtotal": {
"amountSubunits": 1500,
"currencyCode": "USD"
},
"tax": {
"amountSubunits": 0,
"currencyCode": "USD"
},
"total": {
"amountSubunits": 2300,
"currencyCode": "USD"
}
},
"shipping": {
"availableOptions": [
{
"id": "8-Flat Rate Shipping",
"cost": {
"amountSubunits": 800,
"currencyCode": "USD"
}
}
],
"selectedOptionId": "8-Flat Rate Shipping"
}
}
}
Ensure your UI reflects the full cost to the user and allows them to confirm or adjust details if needed.
​
Step 6: Generate a Card Token
In staging, you can use the test token tok_visa to place an order.
Alternatively, follow these steps to build a simple React app that generates tokens with Stripe Elements.
This guide uses Stripe, but Rye supports other payment providers too. See Payment Providers for all options.
​
Step 7: Confirm with Payment
Once the user approves the final cost, confirm the intent with their payment method:

curl

TypeScript SDK

Python SDK

Java SDK

Ruby SDK
const checkoutIntent = await client.checkoutIntents.confirm('id', {
paymentMethod: { stripeToken: 'tok_visa', type: 'stripe_token' },
});
Placing an order is asynchronous. Always poll the GET endpoint after confirming to check the state of the intent.
Once in a terminal state (completed or failed), the intent is finished.
Checkout intents cannot be updated once created. If buyer details (e.g. shipping address) change, create a new checkout intent.
​
Step 8: Poll for Final State
After confirming, poll the GET endpoint again until the intent reaches a terminal state:
completed: order placed successfully
failed: something went wrong (e.g. out of stock, expired)

curl

TypeScript SDK

Python SDK

Java SDK

Ruby SDK
const checkoutIntent = await client.checkoutIntents.retrieve('id');
Example responses:
{ "state": "completed" }
{
"state": "failed",
"failureReason": {
"code": "product_out_of_stock",
"message": "The item is no longer available."
}
}
Check the Rye console to view test orders.
Use the SDK’s confirmAndPoll() helper method to complete steps 7 and 8 in a single call.
Rye does not provide post-purchase tracking or webhooks. Tracking and order updates are sent directly to the buyer’s email address.
​

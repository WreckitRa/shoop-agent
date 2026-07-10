> Agent-readable docs index: /llms.txt. Download /docs.zip to grep all markdown files locally.

---

title: "productByID"
description: "Retrieve a Product by its ID. This includes some basic fields like title, and description. This is useful for displaying products on screens where you need to display products across marketplaces together. But, each product marketplace offers extra metadata and in order to expose that to developers, Rye uses GraphQL inline fragments to expose high-fidelity information about each item."

---

<Note>
  [`AmazonProduct`](/api-reference/amazonproduct) and [`ShopifyProduct`](/api-reference/shopifyproduct) returned by this query have similarities and differences that are compared in detail [here](/amazon-and-shopify-product-comparison)
</Note>

---

### Arguments

<ParamField path="input" type={<a href="/api-reference/productbyidinput">ProductByIDInput!</a>} required>
An object containing the product ID.
</ParamField>

### Returns

<ParamField path="Product" type={<a href="/api-reference/product">Product</a>}>
Any requested field from an object which implements the [`Product`](/api-reference/product) interface.
</ParamField>

<Note>
  The query returns null if the product is not found in the inventory
</Note>

---

### Example - request

<Tabs items={["Amazon hasOffer", "Amazon", "Shopify"]}>
<Tab title="Amazon hasOffer">
`GraphQL
    query($input: ProductByIDInput!) {
      productByID(
        input: $input
      ) {
        id
      	title
        url
        isAvailable
        price {
          value
          currency
        }
        images {
          url
        }
        ... on AmazonProduct {
            color
            weight
            dimensions
            hasOffer(fulfilledByAmazon: true, soldByAmazon: false)
            specifications {
                value
                name
            }
        }
      }
    }
    `
</Tab>

  <Tab title="Amazon">
    ```GraphQL
    query DemoAmazonShopifyProductFetch {
      amazonItem1: productByID(input: { id: "B07H2V5YLH", marketplace: AMAZON }) {
        id
        title
        marketplace
        description
        vendor
        url
        isAvailable
        tags
        images {
          url
        }
        variants {
          title
        }
        price {
          currency
          displayValue
          value
        }
        ... on AmazonProduct {
          ASIN
          titleExcludingVariantName
          categories {
            name
            url
          }
          featureBullets
          parentID
          protectionPlans {
            title
            price {
              value
              currency
              displayValue
            }
            id
          }
          ratingsTotal
          reviewsTotal
          marketplace
          variants {
            title
            image {
              url
              ... on AmazonImage {
                position
                width
                height
              }
            }
          }
          subtitle {
            text
            url
          }
          videos {
            durationSeconds
            width
            height
            url
            thumbnailURL
            title
          }
          specifications {
            name
            value
          }
          color
          manufacturer
          weight
          firstAvailable
          dimensions
          modelNumber
        }
      }
    }
    ```
  </Tab>

  <Tab title="Shopify">
    ```GraphQL
    query DemoShopifyProductByID {
      productByID(input: { id: "7074033139917", marketplace: SHOPIFY }) {
        id
        marketplace
        title
        description
        vendor
        url
        isAvailable
        tags
        images {
          url
        }
        variants {
          ... on ShopifyVariant {
            id
          }
          title
          image {
            url
            ... on ShopifyImage {
              position
              width
              height
            }
          }
        }
        price {
          currency
          displayValue
          value
        }
        ... on ShopifyProduct {
          descriptionHTML
          collectionHandle
          handle
          maxPrice
          minPrice
          productType
          createdAt
          publishedAt
          storeCanonicalURL
          reviewsConnection(first: 5) {
            pageInfo {
              endCursor
              hasNextPage
            }
            edges {
              node {
                id
                body
                helpfulnessCount
                rating
                submittedAt
                reviewerDisplayName
                merchantReply
              }
            }
          }
        }
      }
    }
    ```
  </Tab>
</Tabs>

### Example - response

<Tabs items={["Response (Amazon)", "Response (Shopify)"]}>
<Tab title="Response (Amazon)">
`json
    {
      "data": {
        "amazonItem1": {
          "id": "B07H2V5YLH",
          "title": "Ailun Glass Screen Protector Compatible for iPhone 11/XR,6.1 Inch 3 Pack Tempered Glass",
          "marketplace": "AMAZON",
          "description": "",
          "vendor": "Ailun",
          "url": "https://www.amazon.com/AILUN-Protector-Compatible-Tempered-Anti-Scratch/dp/B07H2V5YLH",
          "isAvailable": true,
          "tags": [],
          "images": [
            {
              "url": "https://m.media-amazon.com/images/I/81MZ5D1wHpL._AC_SL1500_.jpg"
            },
            {
              "url": "https://m.media-amazon.com/images/I/713LD6xbHQL._AC_SL1500_.jpg"
            },
            {
              "url": "https://m.media-amazon.com/images/I/81Y8IOtTvrL._AC_SL1500_.jpg"
            },
            {
              "url": "https://m.media-amazon.com/images/I/81Xzo3AnD1L._AC_SL1500_.jpg"
            },
            {
              "url": "https://m.media-amazon.com/images/I/71pf98FKK6L._AC_SL1500_.jpg"
            },
            {
              "url": "https://m.media-amazon.com/images/I/81X2OoQEtaL._AC_SL1500_.jpg"
            }
          ],
          "variants": [],
          "price": {
            "currency": "USD",
            "displayValue": "$7.98",
            "value": 798
          },
          "ASIN": "B07H2V5YLH",
          "titleExcludingVariantName": "",
          "categories": [
            {
              "name": "All Departments",
              "url": ""
            },
            {
              "name": "Cell Phones & Accessories",
              "url": "https://www.amazon.com/cell-phones-service-plans-accessories/b/ref=dp_bc_aui_C_1?ie=UTF8&node=2335752011"
            },
            {
              "name": "Accessories",
              "url": "https://www.amazon.com/cell-phone-accessories/b/ref=dp_bc_aui_C_2?ie=UTF8&node=2407755011"
            },
            {
              "name": "Maintenance, Upkeep & Repairs",
              "url": "https://www.amazon.com/b/ref=dp_bc_aui_C_3?ie=UTF8&node=21209105011"
            },
            {
              "name": "Screen Protectors",
              "url": "https://www.amazon.com/screen-protectors/b/ref=dp_bc_aui_C_4?ie=UTF8&node=2407781011"
            }
          ],
          "featureBullets": [
            "WORKS FOR iPhone 11/iPhone XR (2019/2018 release) 6.1 Inch display ,0.33mm tempered glass screen protector. Featuring maximum protection from scratches, scrapes, and bumps.",
            "Specialty: Due to the rounded design of the iPhone 11/XR and to enhance compatibility with most cases, the Tempered glass does not cover the entire screen. HD ultra-clear 99.99% touch-screen accurate.",
            "hydrophobic and oleophobic screen coating protects against sweat and oil residue from fingerprints.",
            "It is 100% brand new,Precise laser cut tempered glass, exquisitely polished,2.5D rounded edges.",
            "Online video installation instruction can be found at the last image slot: Easiest Installation - removing dust and aligning it properly before actual installation,no worrying about bubbles,enjoy your screen as if it wasn't there."
          ],
          "parentID": "",
          "protectionPlans": [],
          "ratingsTotal": 323687,
          "reviewsTotal": 0,
          "subtitle": {
            "text": "Visit the Ailun Store",
            "url": "https://www.amazon.com/stores/Ailun/page/52AA3AC5-42CD-4237-BE3F-75EE5051346D?ref_=ast_bln"
          },
          "videos": [
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/17a2f9c7-277a-4f41-a911-47d273f6311b/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/41jJUFhKhHL._CR0,0,360,203_SR342,193_.jpg",
              "title": "Not what I expected"
            },
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/a4c484a7-0ab6-49a6-9aa1-ee541b53ca72/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/51NUaG-6qzL._CR1,0,638,360_SR342,193_.jpg",
              "title": "video installation instruction"
            },
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/83cbd766-99d7-43cf-a362-a1fa24d8a0fa/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/61Bw8jWMVrL._CR0,0,978,552_SR684,386_.jpg",
              "title": "DEMO - 3 Pack Ailun Glass Screen Protector - iPhone 11/iPhone XR"
            },
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/644fe9f7-6888-4301-85f9-632527569cfc/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/51gVQ19paGL._CR2,0,1276,720_SR684,386_.jpg",
              "title": "Plastic, not glass"
            },
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/ec69edb3-179f-42c0-b4a4-030a6ef42438/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/71u3yU9zKKL._CR2,0,1276,720_SR684,386_.jpg",
              "title": "Ailun Glass Screen Protector - Demo & Review"
            },
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/57067bbf-91d9-4723-887e-d2e312190d6b/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/81g0z7EYvZL._CR5,0,1274,719_SR684,386_.jpg",
              "title": "Perfect and easy to install  screen protector! "
            },
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/a8c019d0-c740-4789-8d54-47771f9dde90/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/51hDPFv+ZNL._CR1,0,638,360_SR342,193_.jpg",
              "title": "Screen Protector Compatible + Camera Lens Protector"
            },
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/df9853ac-d81d-444b-8dd9-cdf3336c12a6/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/41L430xX0lL._CR1,0,638,360_SR342,193_.jpg",
              "title": "Iphone xr glass screen protector"
            },
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/5289e8b2-1985-49b8-abf5-6d946097d0b4/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/61lzLqWBteL._CR0,0,1075,607_SR684,386_.jpg",
              "title": "NEW’C Tempered Glass Screen Protector  - UNBOX AND INSTALL"
            },
            {
              "durationSeconds": 0,
              "width": 0,
              "height": 0,
              "url": "https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/c0255bf0-c86d-4192-8dce-2475e63976f9/default.jobtemplate.hls.m3u8",
              "thumbnailURL": "https://m.media-amazon.com/images/I/41xGCNmAK4L._CR1,0,638,360_SR342,193_.jpg",
              "title": "Tempered Glass Screen Protector Installatuon Guide"
            }
          ],
          "specifications": [
            {
              "name": "Product Dimensions",
              "value": "6.5 x 0.43 x 3.54 inches"
            },
            {
              "name": "Item Weight",
              "value": "2.12 ounces"
            },
            {
              "name": "ASIN",
              "value": "B07H2V5YLH"
            },
            {
              "name": "Item model number",
              "value": "iphone11/XR 3GSP"
            },
            {
              "name": "Customer Reviews",
              "value": "4.6 out of 5 stars       323,687 ratings          4.6 out of 5 stars"
            },
            {
              "name": "Best Sellers Rank",
              "value": "#5 in Cell Phones & Accessories"
            },
            {
              "name": "Is Discontinued By Manufacturer",
              "value": "No"
            },
            {
              "name": "Special features",
              "value": "9H Surface Hardness"
            },
            {
              "name": "Other display features",
              "value": "Wireless"
            },
            {
              "name": "Color",
              "value": "Clear"
            },
            {
              "name": "Manufacturer",
              "value": "Siania"
            },
            {
              "name": "Date First Available",
              "value": "September 6, 2018"
            },
            {
              "name": "Brand",
              "value": "Ailun"
            },
            {
              "name": "Compatible Devices",
              "value": "IPhone XR, IPhone 11"
            },
            {
              "name": "Material",
              "value": "Tempered Glass"
            },
            {
              "name": "Item Hardness",
              "value": "9H"
            },
            {
              "name": "Product Dimensions",
              "value": "6.5\"L x 3.54\"W"
            },
            {
              "name": "Compatible Phone Models",
              "value": "Iphone xr, Iphone 11"
            },
            {
              "name": "Special Feature",
              "value": "9H Surface Hardness"
            },
            {
              "name": "Finish Type",
              "value": "Polished"
            },
            {
              "name": "Water Resistance Level",
              "value": "Not Water Resistant"
            },
            {
              "name": "Unit Count",
              "value": "3.0 Count"
            }
          ],
          "color": "Clear",
          "manufacturer": "Siania",
          "weight": "2.12 ounces",
          "firstAvailable": null,
          "dimensions": "6.5\"L x 3.54\"W",
          "modelNumber": null
        }
      }
    }
    `
</Tab>

  <Tab title="Response (Shopify)">
    ```json
    {
      "data": {
        "productByID": {
          "id": "7074033139917",
          "marketplace": "SHOPIFY",
          "title": "Baseball Cap",
          "description": "A classic dad hat never goes out of style—especially one that’s made of 100% organic cotton. The high quality and 100% organic cotton of this hat makes it a sustainable choice. You'll be able to enjoy it for years to come. Complement your stylish outfits with this eco-friendly hat!\n\r\n• 100% organic cotton\r\n• Fabric weight: 8 oz/yd² (271 g/m²)\r\n• 3/1 twill\r\n• Unstructured\r\n• 6 panel\r\n• Matching sewn eyelets\r\n• Self-fabric adjustable closure with a brass slider and hidden tuck-in\r\n• Blank product sourced from China",
          "vendor": "rye-protocol",
          "url": "/products/baseball-cap",
          "isAvailable": true,
          "tags": [],
          "images": [
            {
              "url": "https://cdn.shopify.com/s/files/1/0625/6853/0125/products/organic-baseball-cap-black-front-63212d56edabf.jpg?v=1663118690"
            }
          ],
          "variants": [
            {
              "id": "41160207204557",
              "title": "Default Title",
              "image": {
                "url": "https://cdn.shopify.com/s/files/1/0625/6853/0125/products/organic-baseball-cap-black-front-63212d56edabf.jpg?v=1663118690",
                "position": 1,
                "width": 2000,
                "height": 2000
              }
            }
          ],
          "price": {
            "currency": "USD",
            "displayValue": "$21.00",
            "value": 2100
          },
          "descriptionHTML": "A classic dad hat never goes out of style—especially one that’s made of 100% organic cotton. The high quality and 100% organic cotton of this hat makes it a sustainable choice. You'll be able to enjoy it for years to come. Complement your stylish outfits with this eco-friendly hat!<br>\r\n<br>\r\n• 100% organic cotton<br>\r\n• Fabric weight: 8 oz/yd² (271 g/m²)<br>\r\n• 3/1 twill<br>\r\n• Unstructured<br>\r\n• 6 panel<br>\r\n• Matching sewn eyelets<br>\r\n• Self-fabric adjustable closure with a brass slider and hidden tuck-in<br>\r\n• Blank product sourced from China",
          "collectionHandle": "",
          "handle": "baseball-cap",
          "maxPrice": 2100,
          "minPrice": 2100,
          "productType": "",
          "createdAt": "2022-09-14T09:24:47+08:00",
          "publishedAt": "2022-09-14T09:24:50+08:00",
          "storeCanonicalURL": "https://rye-protocol.myshopify.com",
          "reviewsConnection": {
            "pageInfo": {
              "endCursor": null,
              "hasNextPage": false
            },
            "edges": []
          }
        }
      }
    }
    ```
  </Tab>
</Tabs>

### Related queries

- [`productsByDomainV2`](/api-reference/productsbydomainv2)
- [`productsByIds`](/api-reference/productsbyids)

---

_Powered by [holocron.so](https://holocron.so)_

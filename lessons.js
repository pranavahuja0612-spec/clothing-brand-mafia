// Lesson cards. All lesson text lives here.
//
// id:      unique name, saved once the card has been shown
// trigger: a name that game.js checks (see LESSON_TRIGGERS in game.js), or
//          "mission:<mission id>" to show the card when that mission starts
// title, body: original text, two to four short sentences each
//
// Every card links to the B2B page (CONFIG.b2bPageUrl) using `linkText`.
const LESSONS = [
  {
    id: "cost-per-tee",
    trigger: "first-order-seen",
    title: "Know your cost per tee",
    body:
      "Cost per tee is everything you spend to make one finished shirt: the blank, the ink, " +
      "the screen, the labour and the packaging. Add it up before you set a price, or you can " +
      "sell a hundred shirts and still lose money. Look at the table on each order and find " +
      "the line that costs the most.",
    linkText: "Get help pricing your own line",
  },
  {
    id: "moq",
    trigger: "below-moq-order",
    title: "Minimum order quantity (MOQ)",
    body:
      "Suppliers set a minimum order quantity because a small run takes them almost as much " +
      "effort as a big one. Order fewer than the minimum and you usually pay extra per piece, " +
      "which is the surcharge you just saw. Check a supplier's minimum before you promise a " +
      "small order to a customer.",
    linkText: "See how to work with suppliers",
  },
  {
    id: "gsm",
    trigger: "first-blanks-bought",
    title: "What GSM means",
    body:
      "GSM stands for grams per square metre, and it tells you how heavy a fabric is. A light " +
      "tee around 150 GSM feels thin and cool, while 220 GSM and up feels thick and premium. " +
      "Heavier cloth costs more per blank, so pick the weight that suits your customer and " +
      "your price.",
    linkText: "Choose the right blanks for your brand",
  },
  {
    id: "print-method",
    trigger: "first-unlock",
    title: "Pick the right print method",
    body:
      "Screen printing is cheap per shirt on big runs because you pay for the screen once. " +
      "DTG prints full colour straight onto the fabric with no screen, so it suits small runs, " +
      "but the ink costs more. Embroidery lasts the longest and looks premium, but it is slow " +
      "and has a setup fee for the stitch file. Match the method to the order size and the " +
      "look the customer wants.",
    linkText: "Find the best print method for your order",
  },
  {
    id: "deadstock",
    trigger: "bulk-discount-order",
    title: "Deadstock: stock that does not sell",
    body:
      "Deadstock is stock you bought but cannot sell, like shirts in the wrong size or a design " +
      "nobody wants any more. Bulk discounts make a big order look cheap per tee, but every " +
      "unsold shirt is cash sitting on a shelf. Only buy in bulk when you know the orders are " +
      "coming. The word can also mean leftover fabric from big brands, sold cheaply, which only " +
      "pays off if you use it all.",
    linkText: "Plan your stock without wasting money",
  },
  {
    id: "returns",
    trigger: "first-order-shipped",
    title: "Plan for returns",
    body:
      "Some customers send products back: a misprint, the wrong size, a shirt that arrived " +
      "damaged. Every return costs you the product, the shipping both ways and your time, so " +
      "one return can wipe out the profit from several sales. Check quality before you pack " +
      "and keep a little margin aside for the ones that slip through.",
    linkText: "Learn how to cut down returns",
  },

  // ----- Week 2: shown when the matching mission starts -----
  {
    id: "pricing-for-profit",
    trigger: "mission:price-for-profit",
    title: "Price for profit, not for sales",
    body:
      "Build your price up from your costs, not down from what the shop next door charges. " +
      "Work out your full cost per tee, add the margin you need, and check that the margin " +
      "still holds after discounts and the odd spoiled piece. A price that only covers costs " +
      "leaves nothing to grow with.",
    linkText: "Work out a price that leaves you a profit",
  },
  {
    id: "sampling",
    trigger: "mission:test-run",
    title: "Sample before you go bulk",
    body:
      "Before you print hundreds of pieces, make one or two samples and check the fabric, " +
      "the fit, the print colour and how it survives a wash. A sample costs a little; fixing " +
      "a mistake on three hundred shirts costs a lot. Get the customer to approve the sample " +
      "in writing before the bulk run starts.",
    linkText: "Plan a sample run before your next order",
  },
  {
    id: "cash-flow",
    trigger: "mission:cash-cushion",
    title: "Cash flow keeps the lights on",
    body:
      "Profit on paper is not money in the bank. You pay for blanks, ink and wages before the " +
      "customer pays you, so one big order can leave you short for days. Keep enough cash to " +
      "cover your next few orders, and ask for a deposit on large jobs.",
    linkText: "Keep your cash flow healthy",
  },
  {
    id: "white-label",
    trigger: "mission:win-the-partner",
    title: "White-label or your own brand?",
    body:
      "White-label means you make products that another business sells under its own name, " +
      "like the bulk orders a partner such as Kpda Karkhana sends. It brings steady volume, " +
      "but the brand and most of the margin belong to the client. Your own label keeps the " +
      "margin and the customers, but you carry the risk of design, stock and marketing. Many " +
      "makers do both: white-label work pays the bills while their own label grows.",
    linkText: "Decide between white-label and your own label",
  },
];

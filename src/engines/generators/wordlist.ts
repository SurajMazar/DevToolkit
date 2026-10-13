/**
 * Passphrase wordlist: 2391 common, inoffensive English words of 3–8 lowercase letters,
 * deduplicated and sorted. Each word drawn uniformly adds log2(list length) ≈ 11.22 bits.
 * Stored as one space-separated string to keep the bundle small.
 */
const RAW =
  'able about above absent absorb accent accept access account acid acorn acre across act action active actor ' +
  'actual adapt add address adjust admire admit adobe adopt adult advance advice afford after again agency ' +
  'agenda agent agile agree ahead aid aim air aircraft airport aisle alarm album alcove alert alien align alike ' +
  'alive alley allow almanac almond almost alone along aloud alpha alpine already also alter always amazing ' +
  'amber ambient amble amigo amount ample amulet amuse anchor ancient angel angle animal anise ankle annex ' +
  'annual answer antique antler anvil any apart apex apple apply apricot apron aqua arbor arch archer arctic ' +
  'area arena argon argue aria arise aroma around arrange arrive arrow art artful artist ascend ashore ask ' +
  'aspect aspen asset assist assume astral atlas atom attach attain attend attic auburn audio aunt aurora author ' +
  'auto autumn avenue average avid avocado avoid awake award aware away axis azure baby bacon badge bag bagel ' +
  'bake baker bakery balance balcony ball ballad ballet bamboo banana band banjo bank banner banquet bard barge ' +
  'barley barn baron barrel basalt base basic basil basin basket batch bath battery bay bayou beach beacon bead ' +
  'beagle beak beam bean bear beard beat beauty beaver become bed bedrock bee beef beetle before begin behave ' +
  'behind beige being believe bell belong below belt bench bend benefit beret berry best better between beyond ' +
  'bicycle bike bingo birch bird birth biscuit bison bit black blade blank blanket blazer blend bless blimp ' +
  'blink blitz block bloom blossom blouse blue blues bluff blur board boat bobcat body boil bold bolt bond ' +
  'bonfire bongo bonsai bonus book boost boot border borrow boss both bottle bottom boulder bounce bouquet bowl ' +
  'box boxer brain branch brand brass brave breach bread break breeze brick bridge bridle brief bright brine ' +
  'bring brisk broad bronze brook broom broth brother brown brush bubble bucket buckle buddy budget buffalo ' +
  'bugle build bulb bulldog bumper bundle bunny burger burrow burst bus bush bushel butane butter button buyer ' +
  'buzz cabana cabin cable cactus cadet cage cake caliber calico calm camel cameo camera camp canal candle ' +
  'candor candy canoe canvas canyon cape capital captain car caramel caravan carbon card cardinal cargo carnival ' +
  'carol carpet carrot carry cart case cash cashew cassette castle casual catalog catch catnip cattle cause cave ' +
  'cavern cedar ceiling celery cell cellar cellist cement census cereal certain chair chalk chamber champion ' +
  'change channel chapel chapter charge charm chart chase chateau cheap check cheek cheese chef cherry chess ' +
  'chest chicken chief child chime chimney chipper chisel choice choose chorus chunk cider cinder cinema circle ' +
  'citizen citrus city civil claim clap clarify clarinet clasp class clay clean clear cleat clerk clever click ' +
  'client cliff climb clinic clip clock close cloth cloud clover club clue cluster coach coast coat cobalt ' +
  'cobble cocoa coconut code coffee coin collect college colony color column combine comet comfort comic comma ' +
  'common company compass concert condor confirm connect consider control convert cook cookie cool copper copy ' +
  'coral core corn corner corral correct cosmic cottage cotton couch cougar count country couple course cousin ' +
  'cove cover coyote cozy crab cradle craft crane crater crayon cream credit creek crest crew cricket crisp crop ' +
  'croquet cross crouton crowd crown cruise cruiser crumb crunch crystal cube cubic cuckoo culture cumulus cup ' +
  'cupboard cupcake curious current curry curtain curve cushion custom cycle cypress dad dahlia daily dairy ' +
  'daisy dance dapper dare dash data date dawn day dazzle deal debate debut decade decibel decide deck declare ' +
  'decline decor decoy deep deer define degree delay delight deliver delta demand denim dentist depart depend ' +
  'deposit depot depth derive desert design desk detail detect develop device dewdrop diagram dial diamond diary ' +
  'diesel differ digital dignity dimple diner dingo dinner direct dish display distance ditto divide doctor ' +
  'document dog doll dolphin domain domino donate donkey doodle door dorsal double dough dove down dozen draft ' +
  'dragon drama draw drawer dream dreamer dress drift drill drink drive drizzle droplet drum drummer dry duck ' +
  'duet duffel dugout dune during dust duty dynamic dynamo eager eagle early earn earring earth easel easily ' +
  'east easy echo eclipse ecology economy edge edit educate effort egg eggnog eight either elastic elbow elder ' +
  'elect elegant element elephant elevator elite elixir elm else embark ember emblem embrace emerald emerge ' +
  'emotion empire employ empty enable enact encore endless endorse energy enforce engage engine engrave enhance ' +
  'enjoy enlist enough enrich enroll ensure enter entire entry envelope epic episode equal equator equip erase ' +
  'ermine errand escape escort espresso essay essence estate eternal ethics evening event evidence evolve exact ' +
  'example excess exchange excite exclude excuse exercise exhibit exist exit exotic expand expect expert explain ' +
  'expo express extend extra eyebrow fable fabric face factor faculty fade faint fair falafel falcon fall fallow ' +
  'family famous fancy fanfare fantasy farm fashion father fathom favor feather feature fedora fence fennel ' +
  'ferry festival fetch fever few fiber fiction fiddle field fiesta fig figure file film filter final finale ' +
  'finch find finger finish fire firm first fiscal fish fitness fjord flag flame flannel flash flat flavor fleet ' +
  'flight flip float flock floor flora flower fluent fluid flute focus fog foil folder foliage follow fondue ' +
  'food foot forest forge forget fork format fortune forum forward fossil foster found fountain fox fraction ' +
  'fragile frame fresh friend fringe frog front frost frosty fruit fudge fuel funny furnace fusion future gable ' +
  'gadget gala galaxy gallery gallop game gamut garage garden garlic garment garnet gate gather gaucho gauge ' +
  'gazebo gazelle gear gecko gelato gemstone general genius genre gentle genuine gesture geyser giant gift ' +
  'ginger giraffe give glacier glad glance glass glide glider glimmer globe glory glove glow glue gnome goat ' +
  'goblet goggles gold goldfish golf gondola good goose gopher gorilla gourd govern gown grab grace grade grain ' +
  'granite grant grape grass gravel gravity great green grid griddle grit grizzly grocery group grove grow guard ' +
  'guava guess guide guitar gumbo gusto gym habit haiku hair half halibut hall halo hammer hammock hamster hand ' +
  'happen happy harbor hard harmony harp harvest hat hatch have haven hawk hazard hazel head health heart heath ' +
  'heavy hedge height helix hello helmet help hemlock hen herb heritage hero heron hickory hidden high highway ' +
  'hiker hill hilltop hint hip hire history hobby hockey hold holiday hollow home honey hood hope horizon horn ' +
  'hornet horse hospital host hotel hour hover hubcap huge human humble hummus humor hundred hungry hunt hurdle ' +
  'hurry husky hyacinth hybrid ice iceberg icon idea identify idiom idle igloo ignore iguana image imitate ' +
  'immune impact impala improve impulse incense inch include income increase index indicate indigo indoor inform ' +
  'initial inject inkwell inlet inner input inquiry insect inside insight inspire install intact interest into ' +
  'invest invite iris iron island isle issue item ivory jackal jacket jade jaguar jar jasmine jazz jeans jelly ' +
  'jester jetty jewel jigsaw job jockey jogger join joke journal journey jovial joy jubilee judge juggler juice ' +
  'jukebox jump jungle junior juniper just kale karma kayak keen keep kelp kernel kestrel ketchup kettle key ' +
  'keyboard keynote kid kilt kimono kind kindle kingdom kiosk kipper kitchen kite kitten kiwi knack knee knight ' +
  'knock know koala label ladder lagoon lake lamp language lantern lapel laptop larch large lark lasso latch ' +
  'later lattice laugh laundry laurel lava lavender lawn layer leader leaf learn leather lecture ledger left ' +
  'legacy legal legend leisure lemon lemur lend length lens lentil leopard lesson letter levee level liberty ' +
  'library license lichen lift light lilac lily limb lime limerick limit linden linen lingo link lion liquid ' +
  'list little live lizard load loan lobby lobster local lock locket locust lodge lofty logic long loop lotus ' +
  'loud lounge love loyal lucky luggage lumber lumen lunar lunch luxury lyric lyrics macaw machine mackerel ' +
  'magenta magic magnet magnolia mahogany mail main major make mallard mammal mango mansion mantle manual maple ' +
  'marble march margin marine market maroon marsh mascot mask master match material math matrix matter maximum ' +
  'meadow mean measure meat medal media medley melody melon member memory mention mentor menu mercy merge ' +
  'meringue merit merry mesh message metal meteor method metro middle midnight milk million mimic mind mingle ' +
  'minimum minnow minor mint minute miracle mirror miss mistake mix mixed mobile mocha model modify molten mom ' +
  'moment monarch monitor monkey monster month moon moral more morning mosaic mosquito moss mother motif motion ' +
  'motor mountain mouse move movie much muffin muffler mule multiply mural muscle museum mushroom music must ' +
  'mustang mutual myself mystery myth nacho napkin narrow nation nature near nebula neck nectar need needle ' +
  'neither nephew nerve nest net network neutral never news next nice night nimble noble noise nomad noodle ' +
  'normal north nose notable note nothing notice nougat nova novel now nugget number nurse nut nutmeg oak oasis ' +
  'oatmeal obey object oblige observe obtain obvious occur ocean ocelot octave octopus odor off offer office ' +
  'often oil okay olive omelet omit once one onion online only onyx opal open opera opinion oppose optic option ' +
  'orange orbit orca orchard orchid order ordinary organ orient origami original osprey ostrich other otter ' +
  'outdoor outer outpost output outside oval oven over own owner oxygen oyster ozone pact paddle page pair ' +
  'paisley palace palette palm pancake panda panel panther papaya paper paprika parade parcel parent park parka ' +
  'parrot parsley party pass pastel pastry patch path patient patio pattern pause pave payment peace peacock ' +
  'peanut pear pebble pecan pelican pen pencil pendant penguin peony people pepper perch perfect permit person ' +
  'pesto pet petal pewter pheasant phone photo phrase physical piano piccolo pickle picnic picture piece pig ' +
  'pigeon pilgrim pill pilot pinecone pink pinto pioneer pipe piper pitch pixel pizza place planet plastic plate ' +
  'play plaza please pledge pluck plug plume plunge poem poet point polar pole polka poncho pond pony pool ' +
  'popcorn poppy popular porch portion position possible postcard potato potter pottery powder power practice ' +
  'prairie praise predict prefer prepare present pretty pretzel prevent price pride primary print priority prism ' +
  'private prize problem process produce profit program project promote proof property prose prosper protect ' +
  'proud provide public pudding puffin pull pulsar pulse pumpkin pupil puppy purchase purity purpose purse push ' +
  'puzzle pylon pyramid quail quality quantum quarter quartz quasar quench quest question quick quiet quill ' +
  'quilt quince quit quiz quota quote rabbit raccoon race rack radar radio radish rafter rail rain raise raisin ' +
  'rally ramp ranch random range rapid rapids rare rascal rate rather raven ravine razor ready real realm reason ' +
  'rebel rebuild recall receive recipe record recycle reduce reef reflect reform region regular relax release ' +
  'relic relief rely remain remedy remember remind remove render renew rent reopen repair repeat replace report ' +
  'require rescue resemble resist resource response result retire retreat return reunion reveal review reward ' +
  'rhubarb rhythm ribbon rice rich ride ridge right rigid ring ripple risk ritual rival river rivet road roast ' +
  'robin robot robust rocket rococo rodeo roller romance roof rookie room rose rosemary rotate rough round route ' +
  'royal rubber ruby rudder rug rule run runner runway rural rustic saddle safe saffron sage sail salad salmon ' +
  'salon salsa salt salute same sample sand sapling sardine satchel satisfy sauce sausage savanna save say scale ' +
  'scallop scan scarlet scatter scene scheme school science scissors scone scooter scout scrap screen script ' +
  'scrub sea seagull search season seat second secret section security seed seek segment select sell seminar ' +
  'senior sense sentence sequoia serene series service sesame session settle setup seven shadow shaft shallow ' +
  'shamrock share shed shell sherbet shield shift shine ship shiver shock shoe shop short shoulder shrimp shrine ' +
  'shrug shuffle shy sibling side sienna sierra sight sign signal silent silk silly silver similar simple since ' +
  'sing siren sister sitar situate six size skate sketch ski skill skin skipper skirt skyline slab sleep sleigh ' +
  'slender slice slide slight slim slogan slot sloth slow slush small smart smile smoke smooth snack snake snap ' +
  'snorkel snow soap soccer social sock soda soft solar solid solution solve someone song sonnet soon sorbet ' +
  'sorry sort soul sound soup source south space spare spark sparrow spatial spawn speak special speed spell ' +
  'spend sphere spice spider spike spin spindle spirit split spoil sponsor spoon sport spot spray spread spring ' +
  'sprout spruce square squeeze squirrel stable stadium staff stage stairs stallion stamp stand starling start ' +
  'state stay steak steel stem step stereo stick still sting stock stomach stone stool story stove strategy ' +
  'street strong student stuff stumble style subject submit subway success such sudden sugar suggest suit summer ' +
  'summit sun sundial sunny sunset super supply supreme sure surface surge surprise surround survey sustain ' +
  'swallow swamp swan swap swarm swear sweet swift swim swing switch sycamore symbol symptom syrup system table ' +
  'tackle taco tag tail talent talk talon tamale tandem tango tank tape tapestry target tartan task taste taxi ' +
  'teach team teapot tell tempo ten tenant tennis tent term terrace test text thank that theme then theory there ' +
  'they thimble thing this thistle thought three thrive throw thumb thunder thyme ticket tide tiger tilt timber ' +
  'time timpani tinsel tiny tip tired tissue title toast today toddler toe together token tomato tomorrow tone ' +
  'tongue tonight tool tooth top topaz topic torch tornado tortoise toss total tourist toward tower town toy ' +
  'track trade traffic train transfer trap trash travel tray treat tree trellis trend trial tribe trick trigger ' +
  'trim trip trolley trophy trout truck true truffle truly trumpet trust truth try tube tuition tulip tuna ' +
  'tundra tunnel turbine turkey turn turtle tuxedo twelve twenty twice twilight twin twist two type typical ' +
  'ukulele ultra umber umbrella unable unaware uncle uncover under undo unfold unicorn uniform unique unit ' +
  'universe unknown unlock until unusual unveil upbeat update upgrade uphold uplift upon upper upset urban urge ' +
  'usage use used useful usual utility utopia vacant vacuum valid valley valor valve van vanilla vanish vapor ' +
  'various vast vault vehicle velour velvet vendor venture venue verb verdant verify verse version vertex very ' +
  'vessel veteran viable vibrant victory video view village vintage viola violet violin virtual visa visit vista ' +
  'visual vital vivid vocal voice volcano volume vote voyage voyager waffle wage wagon wait walk wall walnut ' +
  'walrus want warbler warm wasabi wash wasp waste water waterway wave wavelet way wealth wear weasel weather ' +
  'web wedding weekend welcome west wet whale what wheat wheel when where whip whisper wide width wigwam wild ' +
  'will willow win windmill window wine wing wink winner winter wire wisdom wise wish wizard wolf woman wombat ' +
  'wonder wood woodland wool word work world worry worth wrap wren wrist write wrong yacht yak yard yarn year ' +
  'yellow yodel yogurt yonder you young youth yucca zebra zenith zephyr zero zigzag zinc zinnia zipper zodiac ' +
  'zone zoo zucchini'
export const WORDLIST: readonly string[] = Object.freeze(RAW.split(' '))

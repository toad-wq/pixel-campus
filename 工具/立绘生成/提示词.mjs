// 生图提示词：自拍 → 星露谷风「全身」像素立绘。
//
// 几个刻意的选择：
//   1. 明说「输入可能是头像自拍，别沿用它的构图」—— 不写这句，模型会老老实实给你半身。
//   2. 要纯品红背景（#FF00FF）—— 客户端按角落颜色一键抠掉；星露谷衣服里绿色多，不用绿幕。
//   3. 全身 + 双脚入画 + A-pose —— 游戏里要站在地上，半身或者脚被裁掉都用不了。
//   4. 4.5~5 头身 —— 星露谷的比例就是大头短腿，不写会得到写实八头身。
//   5. 禁止抗锯齿和渐变 —— 这是「看起来像素」和「真是像素」的分水岭。

export const 生图提示词 = `Turn the photo into a Stardew Valley style pixel-art game character, as a FULL-BODY sprite.

The input photo is most likely only a head-and-shoulders selfie. Do NOT keep its framing. Extend the person into a complete standing figure, from the top of the head down to the soles of both feet.

Identity (must keep): same face shape, eyes, eyebrows, nose, mouth, hairstyle, hair color, skin tone, and any visible accessories such as glasses, earrings or a hat.
Body: infer a plausible adult build from the face and shoulders. The whole body is visible — no crop anywhere.
Pose: standing straight, facing the viewer, arms relaxed and slightly away from the torso (A-pose), both legs and both feet fully visible, feet about one foot-width apart.
Proportions: about 4.5 to 5 heads tall, matching Stardew Valley's big-head short-legs look.
Outfit: if the photo shows clothing, keep its colors and style; otherwise choose simple farm wear — shirt, overalls or trousers, and boots — in colors that suit the person.
Style: 16-bit pixel art, thick dark 1px outline, 3-tone cel shading, limited warm palette, hard pixel edges, no anti-aliasing, no gradients, no ground shadow.
Background: perfectly flat solid #FF00FF magenta — no scenery, no props, no vignette.
Framing: the figure fills about 85% of the frame height, with a small even margin above the head and a clear empty margin below the feet.
Do not draw text, UI, borders or watermarks.`

// 两段式第一步：自拍 → 写实全身照。
// 这一段只负责「把身体补出来、把人认住」，不管像素风；背景给纯色，方便第二步看图。
export const 全身照片提示词 = `Extend this selfie into a full-length photograph of the SAME person.

Keep identity exactly: face shape, eyes, eyebrows, nose, mouth, hairstyle, hair color, skin tone, and any visible accessories such as glasses or earrings.
Body: infer a natural adult body from the face and shoulders, realistic proportions (about 7 heads tall).
Pose: standing straight, facing the camera, arms relaxed at the sides, both legs and both feet fully visible, feet slightly apart.
Clothing: if the photo shows clothing, keep its colors and style; otherwise choose simple everyday clothes — a plain t-shirt or sweater, trousers or jeans, and sneakers — in neutral colors.
Lighting: soft even daylight, no harsh shadow.
Background: plain seamless light-gray studio background, no props, no text.
Framing: full body, from the top of the head to the soles of both feet, with a little empty space above the head and below the feet.
Photorealistic, sharp focus, 35mm photograph.`

// 两段式第二步：写实全身照 → 像素立绘。
// 输入已经是全身了，所以这段不再要求「补身体」，只要求「保持姿势和衣服、压成像素」。
export const 像素立绘提示词 = `Convert the full-body reference photo into a Stardew Valley style pixel-art character sprite.

Keep: the same pose, the same outfit and its colors, the same hairstyle and skin tone, and a recognisable version of the face.
Full body: the whole figure, from the top of the head to the soles of both feet. No crop anywhere.
Style: 16-bit pixel art, thick dark 1px outline, 3-tone cel shading, limited warm palette, hard pixel edges, no anti-aliasing, no gradients, no ground shadow.
Proportions: about 4.5 to 5 heads tall, matching Stardew Valley's big-head short-legs look.
Background: perfectly flat solid #FF00FF magenta — no scenery, no props.
Framing: the figure fills about 85% of the frame height, with a small margin above the head and below the feet.
Do not draw text, UI, borders or watermarks.`

// 全身校验没通过时，把这段接在后面重试一次。
export const 全身加强提示 = `The previous result was not a full body — the legs or feet were cut off by the frame.

Redraw it as a true full-body sprite:
- the entire figure, from the top of the head to the soles of BOTH feet, must fit inside the frame with empty margin below the feet;
- do not zoom in on the upper body, do not crop at the hips, knees or ankles;
- keep the face and hairstyle identical to the reference photo;
- same flat #FF00FF background, same pixel-art style, same palette.`

// 人设卡用（和立绘配套的右侧面板数据）。
export const 人设提示词 = `You are generating a Stardew Valley style NPC profile for the person in the photo.
Reply with JSON only, no markdown fence, keys exactly:
{"名字":"","等级":"Lv.1","职业":"","台词":"","生日":{"季节":"Spring|Summer|Fall|Winter","日":1},"性格":"","最爱的食物":"","喜欢":["","",""],"讨厌":["","",""],"宠物":{"名字":"","描述":""}}
Rules: 名字用英文名；职业要像星露谷的职业（例如 Cartographer / Teen Tinkerer / Fisher）；台词一句英文，温柔或古怪；
最爱的食物、喜欢、讨厌必须是星露谷里真实存在的物品；生日季节四选一，日 1-28；性格写成 1-2 句英文。`

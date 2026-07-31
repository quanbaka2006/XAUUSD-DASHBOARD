#import "SCOverlayManager.h"
#import <QuartzCore/QuartzCore.h>
#import <dlfcn.h>

typedef CGImageRef (*SCGetScreenImageFunction)(void);
typedef UIImage *(*SCCreateScreenUIImageFunction)(void);

@interface SCPassthroughWindow : UIWindow
@property (nonatomic, assign) CGRect hotZone;
@property (nonatomic, assign) BOOL selecting;
@end

@implementation SCPassthroughWindow
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    if (self.selecting || CGRectContainsPoint(self.hotZone, point)) {
        return [super hitTest:point withEvent:event];
    }
    return nil;
}
@end

@interface SCOverlayManager () <UIGestureRecognizerDelegate>
@property (nonatomic, strong) SCPassthroughWindow *window;
@property (nonatomic, strong) UIView *rootView;
@property (nonatomic, strong) UIView *selectionView;
@property (nonatomic, strong) NSMutableArray<UIImageView *> *clones;
@property (nonatomic, strong) UIImage *screenImage;
@property (nonatomic, assign) CGPoint dragStart;
@property (nonatomic, assign) BOOL clonesVisible;
@property (nonatomic, assign) BOOL started;
@end

@implementation SCOverlayManager

+ (instancetype)sharedManager {
    static SCOverlayManager *manager;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        manager = [SCOverlayManager new];
    });
    return manager;
}

- (void)start {
    if (self.started) return;
    self.started = YES;
    self.clones = [NSMutableArray array];
    self.clonesVisible = YES;

    CGRect bounds = UIScreen.mainScreen.bounds;
    self.window = [[SCPassthroughWindow alloc] initWithFrame:bounds];
    self.window.windowLevel = UIWindowLevelAlert + 1000.0;
    self.window.backgroundColor = UIColor.clearColor;
    self.window.hotZone = CGRectMake(0, 0, 50, 50);

    UIViewController *controller = [UIViewController new];
    controller.view.backgroundColor = UIColor.clearColor;
    self.rootView = controller.view;
    self.window.rootViewController = controller;

    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc]
        initWithTarget:self action:@selector(toggleClones)];
    tap.delegate = self;
    [self.rootView addGestureRecognizer:tap];

    self.window.hidden = NO;
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gesture
       shouldReceiveTouch:(UITouch *)touch {
    if (self.window.selecting) return NO;
    CGPoint point = [touch locationInView:self.rootView];
    return CGRectContainsPoint(self.window.hotZone, point);
}

- (void)toggleClones {
    self.clonesVisible = !self.clonesVisible;
    for (UIImageView *clone in self.clones) {
        clone.hidden = !self.clonesVisible;
    }
}

- (void)activateCapture {
    if (self.window.selecting) return;
    [self beginSelection];
}

- (UIImage *)captureScreen {
    SCCreateScreenUIImageFunction createScreenUIImage =
        (SCCreateScreenUIImageFunction)dlsym(RTLD_DEFAULT, "_UICreateScreenUIImage");
    if (createScreenUIImage) {
        UIImage *image = createScreenUIImage();
        if (image) return image;
    }

    SCGetScreenImageFunction getScreenImage =
        (SCGetScreenImageFunction)dlsym(RTLD_DEFAULT, "UIGetScreenImage");
    if (!getScreenImage) return nil;
    CGImageRef imageRef = getScreenImage();
    if (!imageRef) return nil;
    UIImage *image = [UIImage imageWithCGImage:imageRef
                                         scale:UIScreen.mainScreen.scale
                                   orientation:UIImageOrientationUp];
    CGImageRelease(imageRef);
    return image;
}

- (void)beginSelection {
    BOOL wasHidden = self.window.hidden;
    self.window.hidden = YES;
    self.screenImage = [self captureScreen];
    self.window.hidden = wasHidden;
    if (!self.screenImage) return;

    self.window.selecting = YES;
    self.rootView.backgroundColor = [UIColor colorWithWhite:0 alpha:0.08];
    UIImpactFeedbackGenerator *feedback =
        [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
    [feedback impactOccurred];
    self.clonesVisible = YES;
    for (UIImageView *clone in self.clones) clone.hidden = NO;

    UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc]
        initWithTarget:self action:@selector(selectionPanned:)];
    [self.rootView addGestureRecognizer:pan];
}

- (void)selectionPanned:(UIPanGestureRecognizer *)gesture {
    CGPoint point = [gesture locationInView:self.rootView];
    if (gesture.state == UIGestureRecognizerStateBegan) {
        self.dragStart = point;
        self.selectionView = [[UIView alloc] initWithFrame:CGRectMake(point.x, point.y, 1, 1)];
        self.selectionView.backgroundColor = [UIColor colorWithWhite:1 alpha:0.12];
        self.selectionView.layer.borderColor = UIColor.whiteColor.CGColor;
        self.selectionView.layer.borderWidth = 1.0;
        [self.rootView addSubview:self.selectionView];
    } else if (gesture.state == UIGestureRecognizerStateChanged) {
        self.selectionView.frame = [self normalizedRectFrom:self.dragStart to:point];
    } else if (gesture.state == UIGestureRecognizerStateEnded) {
        CGRect rect = self.selectionView.frame;
        [self.selectionView removeFromSuperview];
        self.selectionView = nil;
        [self.rootView removeGestureRecognizer:gesture];
        self.window.selecting = NO;
        self.rootView.backgroundColor = UIColor.clearColor;
        if (rect.size.width >= 4 && rect.size.height >= 4) {
            [self addCloneForRect:rect];
        }
        self.screenImage = nil;
    } else if (gesture.state == UIGestureRecognizerStateCancelled ||
               gesture.state == UIGestureRecognizerStateFailed) {
        [self.selectionView removeFromSuperview];
        self.selectionView = nil;
        [self.rootView removeGestureRecognizer:gesture];
        self.window.selecting = NO;
        self.rootView.backgroundColor = UIColor.clearColor;
        self.screenImage = nil;
    }
}

- (CGRect)normalizedRectFrom:(CGPoint)a to:(CGPoint)b {
    return CGRectMake(MIN(a.x, b.x), MIN(a.y, b.y),
                      fabs(b.x - a.x), fabs(b.y - a.y));
}

- (void)addCloneForRect:(CGRect)rect {
    CGFloat scale = self.screenImage.scale;
    CGRect pixelRect = CGRectMake(rect.origin.x * scale,
                                  rect.origin.y * scale,
                                  rect.size.width * scale,
                                  rect.size.height * scale);
    pixelRect = CGRectIntersection(pixelRect,
                                   CGRectMake(0, 0,
                                              CGImageGetWidth(self.screenImage.CGImage),
                                              CGImageGetHeight(self.screenImage.CGImage)));
    if (CGRectIsEmpty(pixelRect)) return;

    CGImageRef croppedRef = CGImageCreateWithImageInRect(self.screenImage.CGImage, pixelRect);
    if (!croppedRef) return;
    UIImage *cropped = [UIImage imageWithCGImage:croppedRef
                                           scale:scale
                                     orientation:UIImageOrientationUp];
    CGImageRelease(croppedRef);

    UIImageView *clone = [[UIImageView alloc] initWithFrame:rect];
    clone.image = cropped;
    clone.contentMode = UIViewContentModeScaleToFill;
    clone.userInteractionEnabled = NO;
    clone.layer.borderWidth = 0;
    clone.layer.cornerRadius = 0;
    clone.clipsToBounds = YES;
    [self.rootView addSubview:clone];
    [self.clones addObject:clone];
}

@end

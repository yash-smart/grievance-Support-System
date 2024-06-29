import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv"
import bcrypt from "bcrypt";
import session from "express-session";
import cookieParser from "cookie-parser";
import nodemailer from "nodemailer";

env.config();

const app = express();

const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "grievance-support-system",
    password: process.env.DB_PASSWORD,
    port: 5432,
});
db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  rolling: true,
  cookie: { 
    secure: false, 
    maxAge: 3600000
} // Set secure to true in production with HTTPS
}));

app.get('/',(req,res) => {
    res.render('index.ejs');
})

app.get("/login",(req,res) => {
    if (req.session.user === undefined) {
        res.render("login.ejs")
    } else {
        res.redirect('/main/'+req.session.user);
    }
})

app.post('/login',async (req,res) => {
    try {
        let user_data = await db.query('select * from users where username=$1;',[req.body.Username.trim()]);
        if (user_data.rows.length>0) {
            let correct_password = user_data.rows[0].password;
            bcrypt.compare(req.body.Password, correct_password, function(err, result) {
                if (result) {
                    req.session.user = user_data.rows[0].user_id;
                    res.redirect('/main/'+req.session.user);
                } else {
                    res.render('login.ejs',{message: 'Invalid Password.'})
                }
            });
        } else {
            res.render('login.ejs',{message: 'User doesn\'t exists.'})
        }
    } catch(err) {
        console.log(err)
        res.render('login.ejs',{message: 'Something went wrong. Try again.'})
    }
})

app.get('/register',(req,res) => {
    if (req.session.user == undefined) {
        res.render('register.ejs')
    } else {
        res.redirect('/main/'+req.session.user)
    }
})

app.post('/register',async (req,res) => {
    try {
        let user_exist_data = await db.query('select * from users where username=$1;',[req.body.Username.trim()]);
        if (user_exist_data.rows.length>0) {
            res.render('register.ejs',{message: 'User already exists.'})
        } else {
            bcrypt.hash(req.body.Password, 10, async function(err, hash) {
                try {
                    // let department_ids = [];
                    let user_id_data = await db.query('insert into users(username,password,role,email) values($1,$2,$3,$4) RETURNING user_id;',[req.body.Username.trim(),hash,req.body.Role,req.body.Email]);
                    let user_id = user_id_data.rows[0].user_id;
                    if (req.body.Department) {
                        for (let i=0;i<req.body.Department.length;i++) {
                            let id_data = await db.query('select id from department where department=$1;',[req.body.Department[i]]);
                            await db.query('insert into user_department values($1,$2)',[user_id,id_data.rows[0].id]);
                        }
                    }
                    res.redirect('/login')
                } catch (err) {
                    res.render('register.ejs',{message: 'Something went wrong. Try again.'})
                    console.log(err)
                }
            });
        }
    } catch(err) {
        res.render('register.ejs',{message: 'Something went wrong. Try again.'})
        console.log(err)
    }
})

app.get('/main/:user_id',async (req,res) => {
    if (req.params.user_id == req.session.user) {
        let user_details = await db.query('select * from users where user_id=$1;',[req.params.user_id]);
        user_details = user_details.rows[0];
        if (user_details.role === 'Employee') {
            console.log(req.params.user_id)
            let grievances_open_data = await db.query('select * from grievance where emp_id=$1 and status=\'open\' order by grievance_post_datetime desc',[req.params.user_id]);
            res.render('employee_main.ejs',{data:grievances_open_data.rows,user_id:req.params.user_id});
        } else if (user_details.role === 'Administrator') {
            let grievance_data = await db.query('select * from grievance where status=\'open\' order by grievance_post_datetime desc;');
            let departments = [];
            for (let i=0;i<grievance_data.rows.length;i++) {
                let dept_id = grievance_data.rows[i].department_id;
                let department = await db.query('select department from department where id=$1;',[dept_id]);
                department = department.rows[0].department;
                departments.push(department);
            }
            res.render('admin_main.ejs',{grievance_data:grievance_data.rows,message:'Open',user_id:req.params.user_id,sendtohrbutton:true,departments:departments});
        } else {
            res.render('hr_main.ejs');
        }
    } else {
        res.send('Unauthorised');
    }
    
})

app.post('/grievancePost/:user_id',async (req,res) => {
    try {
        let department_data = await db.query('select id from department where department=$1;',[req.body.Department]);
        await db.query('insert into grievance(emp_id,grievance_title,grievance_desc,department_id,status,grievance_post_datetime) values($1,$2,$3,$4,\'open\',$5);',[req.params.user_id,req.body.Title,req.body.Description,department_data.rows[0].id,new Date()]);
        res.redirect('/main/'+req.params.user_id)
    } catch (err) {
        res.send('Something Went Wrong!')
    }
});

app.post('/selectPost/:user_id',async (req,res) => {
    let request = req.body.category.toLowerCase();
    let data = await db.query('select * from grievance where emp_id = $1 and status=\''+request+'\';',[req.params.user_id]);
    res.render('employee_main.ejs',{user_id:req.params.user_id,data:data.rows});
})

app.get('/grievance/:id/:user_id',async (req,res) => {
    let grievance_data = await db.query('select * from grievance where id=$1;',[req.params.id]);
    let comments_data = await db.query('select * from comments where grievance_id=$1 order by posted_on desc;',[req.params.id]);
    comments_data =comments_data.rows;
    let senders = [];
    for (let i=0;i<comments_data.length;i++) {
        let sender_data = await db.query('select username from users where user_id=$1;',[comments_data[i].sender]);
        senders.push(sender_data.rows[0].username);
    }
    res.render('grievance.ejs',{comments_data:comments_data,senders:senders,grievance_data:grievance_data.rows[0],grievance_id:req.params.id,user_id:req.params.user_id});
});

app.post('/postComment/:id/:user_id',async (req,res) => {
    await db.query('insert into comments(comment,sender,posted_on,grievance_id) values($1,$2,$3,$4);',[req.body.comment,req.params.user_id,new Date(),req.params.id]);
    res.redirect('/grievance/'+req.params.id+'/'+req.params.user_id);
})

app.post('/selectPostAdmin/:user_id',async(req,res) => {
    let request = req.body.category.toLowerCase();
    let data = await db.query('select * from grievance where status=\''+request+'\'order by grievance_post_datetime desc;');
    if (request == 'open') {
        let departments = [];
        for (let i=0;i<data.rows.length;i++) {
            let dept_id = data.rows[i].department_id;
            let department = await db.query('select department from department where id=$1;',[dept_id]);
            department = department.rows[0].department;
            departments.push(department);
        }
        res.render('admin_main.ejs',{grievance_data:data.rows,message:req.body.category,user_id:req.params.user_id,sendtohrbutton:true,departments:departments});
    } else {
        let departments = [];
        for (let i=0;i<data.rows.length;i++) {
            let dept_id = data.rows[i].sent_to_department_id;
            let department = await db.query('select department from department where id=$1;',[dept_id]);
            department = department.rows[0].department;
            departments.push(department);
        }
        res.render('admin_main.ejs',{grievance_data:data.rows,message:req.body.category,user_id:req.params.user_id,sendtohrbutton:false,departments:departments});
    }
})

app.get('/sendToHR/:id/:user_id',async (req,res) => {
    let dept_id = await db.query('select department_id from grievance where id=$1;',[req.params.id]);
    dept_id = dept_id.rows[0].department_id
    await db.query('update grievance set sent_to_department_id=$1,status=\'sent to hr\' where id=$1;',[req.params.id]);
    res.redirect('/main/'+req.params.user_id);
})

app.post('/sendToHR/:id/:user_id',async (req,res) => {
    let dept_id = await db.query('select id from department where department=$1;',[req.body.Department]);
    await db.query('update grievance set sent_to_department_id=$1,status=\'sent to hr\' where id=$2;',[dept_id.rows[0].id,req.params.id]);
    res.redirect('/main/'+req.params.user_id);
})

app.listen(3000,() => {
    console.log(`Connected on http://localhost:3000`)
})